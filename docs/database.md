# Database

`src/db/database.ts` — the CLI's sqlite database: one connection, opened
once, shared by every module.

- **File location**: `~/.apiweiser-cli/db.sqlite` — a directory
  dedicated to this CLI, separate from any repo being scanned (same idea as
  the Renovate report cache, the changelog notes and the codemod registry).
- **Engine**: Node's stdlib `node:sqlite` (`DatabaseSync`), not a
  third-party package.
- **Access pattern**: `Database` owns the connection and schema; it doesn't
  know about `packages`, `call_sites` or `changelog_sources` as domain
  concepts beyond creating their tables. Each module has its own
  `*Repository` class (`DependenciesRepository`, `ChangelogSourcesRepository`,
  and the dashboard's read-only `DashboardRepository`) that takes a
  `Database` injected via constructor and runs its own queries against
  `db.connection`. See [`docs/scanner.md`](./scanner.md) and
  [`docs/changelogs.md`](./changelogs.md) for how each repository is used.
- **Foreign keys are enforced**: `PRAGMA foreign_keys = ON` is run once in
  the constructor. SQLite disables FK enforcement by default per connection
  — without this pragma, `call_sites.package_id`/`changelog_sources.package_id`
  would silently accept invalid references instead of raising an error.
- **Singleton lives in a separate file**: `src/db/singleton.ts` —
  `export const db = new Database()`, plus the `process.on("exit", ...)`
  close hook. Deliberately _not_ in `database.ts` itself: importing the
  `Database` class (e.g. from a test, to build an isolated `:memory:`
  instance) must not have the side effect of opening the real
  `~/.apiweiser-cli/db.sqlite` file. When that side effect lived in
  `database.ts`, every test file that imported the class triggered it too,
  and concurrent test runs raced to open and migrate the same real file.
  `database.ts` now only exports the `Database` class — no side effects on
  import.

## Schema

All tables are created with `CREATE TABLE IF NOT EXISTS` in
`Database.migrate()`, run once in the constructor — there's no separate
migration runner or versioning, just idempotent statements: two
`ALTER TABLE`/`DROP TABLE` lines clean up after older versions (the
`data_sources` → `changelog_sources` rename, and the removed
`pending_changelog_lookups` queue). Changing an existing table's columns
means deleting `~/.apiweiser-cli/db.sqlite` and letting it recreate.

### `packages`

Populated by `DependenciesRepository` (from `scan`), **one row per `(repo_path, name)` pair**
— not per package name alone. This used to be name-only, a real bug for
multi-repo use: two repos depending on the same package at different
versions shared a single global row, so scanning the second repo silently
overwrote the first repo's version (and, via `call_sites`' FK, orphaned or
misattributed its call sites too - see below). `repo_path` is always the
canonicalized, absolute repo path (`node:path`'s `resolve()`), resolved
once at the start of every command, so the
same repo scanned via a relative path one run and an absolute path the
next is still recognized as the same repo, not a second one.

Re-scanning the same repo `UPSERT`s (`ON CONFLICT(repo_path, name) DO
UPDATE`) rather than inserting new rows, so `current_version`/`type`
always reflect that repo's most recent scan.

`upsert()` uses `... RETURNING id` and writes the result straight onto each
`Dependency` object's `id` field, in the same statement as the
insert/update — no separate `SELECT` afterward. `find(repoPath, name)`
returns a row's `id` and `currentVersion` for the commands that start from
a package name (`changelog`, `codemod`, `plan`'s `from`).

A package installed at several versions (an older copy nested under another
package) is recorded once, at its top-level copy - the one the repo itself
resolves (see `SbomTool`).

| column            | type    | notes                                         |
| ----------------- | ------- | --------------------------------------------- |
| `id`              | INTEGER | primary key, autoincrement                    |
| `repo_path`       | TEXT    | absolute path of the repo this row belongs to |
| `name`            | TEXT    | package name, e.g. `"commander"`              |
| `current_version` | TEXT    | the installed version, read from node_modules |
| `type`            | TEXT    | `"direct"` or `"transitive"`                  |

`UNIQUE(repo_path, name)` - the same package name can have one row per
repo, but only one row per repo.

A package's changelog source (`changelog_sources`, below) and its codemods
(see [`docs/codemods.md`](./codemods.md)) are properties of the package, not
of whichever repo depends on it - both are looked up by name, never by
`repo_path`, so what one repo found is reused by the next.

### `call_sites`

Populated by `DependenciesRepository` (from `scan`), one row per place a scanned
dependency's API is actually called (see [`docs/scanner.md`](./scanner.md)
for how `Scanner` finds these). `package_id` is a foreign key into
`packages` — `scan` always upserts packages first, so the
package a call site belongs to is guaranteed to exist by the time the call
site is inserted. Unlike `changelog_sources` below, `insertCallSites` still
resolves `package_id` via a `(SELECT id FROM packages WHERE repo_path = ?
AND name = ?)` subquery rather than `dependency.id` — `CallSite` only
carries the dependency's name (from `Scanner`, which doesn't touch the
database), not the `Dependency` object itself, so there's no `id` on hand
to reuse. Every call-site method takes `repoPath` explicitly,
for the same reason `packages` does - resolving `package_id` by name alone
would risk matching a different repo's row for the same package name.

| column        | type    | notes                                                  |
| ------------- | ------- | ------------------------------------------------------ |
| `id`          | INTEGER | primary key, autoincrement                             |
| `package_id`  | INTEGER | `REFERENCES packages(id)`, not null                    |
| `file`        | TEXT    | absolute path of the source file                       |
| `line`        | INTEGER | 1-based line of the call                               |
| `snippet`     | TEXT    | source text of the resolved call/`new` expression      |
| `api_surface` | TEXT    | member invoked, e.g. `"Command"` or `"Command.option"` |
| `scanned_at`  | TEXT    | defaults to `CURRENT_TIMESTAMP`                        |

To read a call site with its package name, join `call_sites` to `packages`
through `package_id`.

### `changelog_sources`

Populated by `ChangelogSourcesRepository`, one row per package the
`changelog` command found a changelog source URL for (see
[`docs/changelogs.md`](./changelogs.md)). Written the first time `changelog`
needs a package's source; every later run reads it back with `findUrl`
instead of asking npm again. A package npm has no GitHub repo for never gets
a row - there's no URL to record, so it's looked up again next time.

| column       | type    | notes                                                                         |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| `id`         | INTEGER | primary key, autoincrement                                                    |
| `package_id` | INTEGER | `REFERENCES packages(id)`, not null                                           |
| `url`        | TEXT    | GitHub API releases endpoint (`api.github.com/repos/<owner>/<repo>/releases`) |
| `created_at` | TEXT    | defaults to `CURRENT_TIMESTAMP`                                               |

`ChangelogSourcesRepository.insert()` takes `Map<packageId, url>` and inserts
`package_id` directly — no subquery, since `changelog` already has the
package's `id` from `DependenciesRepository.find()`.

### `suggestions` and `pull_requests`

Written by the old daily-job flow (Renovate's proposed updates, and the PRs
it opened), which the commands replaced. Nothing writes them any more, but
the dashboard still reads them, so rows from older versions keep showing
there. Their columns are in `Database.migrate()`.

## Adding a new table

Add a `this.db.exec(\`CREATE TABLE IF NOT EXISTS ...\`)`call in`Database.migrate()`, then write a repository class next to whichever
module owns that data — inject `Database`, query through `.connection`.
Don't add table-creation or query logic to `Database`itself beyond`migrate()`; it stays a thin connection/schema wrapper.
