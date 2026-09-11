# Database

`src/db/database.ts` — the CLI's sqlite database: one connection, opened
once, shared by every module.

- **File location**: `~/.apiweiser-cli/db.sqlite` — a directory
  dedicated to this CLI, separate from any repo being scanned (same idea as
  the SBOM/Renovate report caches).
- **Engine**: Node's stdlib `node:sqlite` (`DatabaseSync`), not a
  third-party package.
- **Access pattern**: `Database` owns the connection and schema; it doesn't
  know about `packages`, `call_sites`, `data_sources`, or `suggestions` as
  domain concepts beyond creating their tables. Each module has its own
  `*Repository` class (`PackagesRepository`, `CallSitesRepository`,
  `DataSourcesRepository`, `PendingChangelogLookupsRepository`,
  `ReleaseAnalysisRepository`,
  `SuggestionsRepository`, `PullRequestsRepository`) that takes a `Database`
  injected via constructor and runs its own queries against
  `db.connection`. See [`docs/scanner.md`](./scanner.md),
  [`docs/data-sources.md`](./data-sources.md), and
  [`docs/suggestions.md`](./suggestions.md) for how each repository is used.
- **Foreign keys are enforced**: `PRAGMA foreign_keys = ON` is run once in
  the constructor. SQLite disables FK enforcement by default per connection
  — without this pragma, `call_sites.package_id`/`data_sources.package_id`
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
migration runner or versioning, just idempotent `CREATE TABLE`s. Changing an
existing table's columns means deleting `~/.apiweiser-cli/db.sqlite`
and letting it recreate; there's no `ALTER TABLE` step.

### `packages`

Populated by `PackagesRepository`, **one row per `(repo_path, name)` pair**
— not per package name alone. This used to be name-only, a real bug for
multi-repo use: two repos depending on the same package at different
versions shared a single global row, so scanning the second repo silently
overwrote the first repo's version (and, via `call_sites`' FK, orphaned or
misattributed its call sites too - see below). `repo_path` is always the
canonicalized, absolute repo path (`node:path`'s `resolve()`), resolved
once in `DependenciesModule.scan()`/`SuggestionsModule.generate()`, so the
same repo scanned via a relative path one run and an absolute path the
next is still recognized as the same repo, not a second one.

Re-scanning the same repo `UPSERT`s (`ON CONFLICT(repo_path, name) DO
UPDATE`) rather than inserting new rows, so `current_version`/`type`
always reflect that repo's most recent scan.

`upsert()` uses `... RETURNING id` and writes the result straight onto each
`Dependency` object's `id` field, in the same statement as the
insert/update — no separate `SELECT` afterward. Downstream code that
already has the (now-mutated) `Dependency` in hand, like
`DataSourcesRepository`, uses `dependency.id` directly instead of looking
the id up again by name. `CallSitesRepository` is the exception — see the
`call_sites` note below.

| column            | type    | notes                                         |
| ----------------- | ------- | --------------------------------------------- |
| `id`              | INTEGER | primary key, autoincrement                    |
| `repo_path`       | TEXT    | absolute path of the repo this row belongs to |
| `name`            | TEXT    | package name, e.g. `"commander"`              |
| `current_version` | TEXT    | from the SBOM                                 |
| `type`            | TEXT    | `"direct"` or `"transitive"`                  |

`UNIQUE(repo_path, name)` - the same package name can have one row per
repo, but only one row per repo.

**Deliberately global, not per-repo**: `PackagesRepository.findNew()`
checks existence by `name` alone, ignoring `repo_path` - "new" means new to
this CLI globally (across every repo it's ever scanned), not new to one
repo. A package's changelog source (`data_sources`, below) is a property
of the package, not of whichever repo happens to depend on it, so a second
repo introducing an already-known package shouldn't re-trigger that lookup.
This is also what lets a breaking-release classification or a generated
codemod (see [`docs/change-requests.md`](./change-requests.md)) found via
one repo apply to another - those are keyed by package identity, never by
`repo_path`.

### `call_sites`

Populated by `CallSitesRepository`, one row per place a scanned
dependency's API is actually called (see [`docs/scanner.md`](./scanner.md)
for how `Scanner` finds these). `package_id` is a foreign key into
`packages` — `DependenciesModule` always upserts packages first, so the
package a call site belongs to is guaranteed to exist by the time the call
site is inserted. Unlike `data_sources` below, `CallSitesRepository` still
resolves `package_id` via a `(SELECT id FROM packages WHERE repo_path = ?
AND name = ?)` subquery rather than `dependency.id` — `CallSite` only
carries the dependency's name (from `Scanner`, which doesn't touch the
database), not the `Dependency` object itself, so there's no `id` on hand
to reuse. Every `CallSitesRepository` method takes `repoPath` explicitly,
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

### `pending_changelog_lookups`

The queue: one row per package waiting for a changelog-source lookup (see
[`docs/data-sources.md`](./data-sources.md)). `DependenciesModule.scan()`
inserts into this table for brand-new packages — no network call, just a
queue entry — and `DataSourcesModule.processPendingLookups()` (run on a
schedule, not inline with a scan) drains it in batches, deleting a row
once its lookup resolves (to a URL _or_ a definitive "no source exists" —
either way, there's nothing left to look up).

| column       | type    | notes                                                        |
| ------------ | ------- | ------------------------------------------------------------ |
| `id`         | INTEGER | primary key, autoincrement                                   |
| `package_id` | INTEGER | `REFERENCES packages(id)`, unique, not null                  |
| `created_at` | TEXT    | defaults to `CURRENT_TIMESTAMP`; also the queue's FIFO order |

`package_id` is `UNIQUE` so re-enqueuing an already-queued package
(`INSERT OR IGNORE`) is a no-op rather than a duplicate row.

### `data_sources`

Populated by `DataSourcesRepository`, one row per package
`DataSourcesModule` actually found a changelog source URL for (see
[`docs/data-sources.md`](./data-sources.md)). Only ever written for
packages that are brand new to `packages` — a version bump on a package
already known doesn't produce a new row here. A package whose lookup
resolves to "no source exists" is removed from `pending_changelog_lookups`
but never gets a row here — there's no URL to record.

| column       | type    | notes                                                                         |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| `id`         | INTEGER | primary key, autoincrement                                                    |
| `package_id` | INTEGER | `REFERENCES packages(id)`, not null                                           |
| `url`        | TEXT    | GitHub API releases endpoint (`api.github.com/repos/<owner>/<repo>/releases`) |
| `created_at` | TEXT    | defaults to `CURRENT_TIMESTAMP`                                               |

`DataSourcesRepository.insert()` takes `Map<packageId, url>` and inserts
`package_id` directly — no subquery, since `DataSourcesModule` already has
each `Dependency`'s `id` (set by `PackagesRepository.upsert()`) on hand.

### `release_analysis_runs`

One row per `ReleaseAnalysisModule.run()` invocation (see
[`docs/data-sources.md`](./data-sources.md) § Release analysis) — when it
started, ended, and its outcome.

| column       | type    | notes                                                            |
| ------------ | ------- | ---------------------------------------------------------------- |
| `id`         | INTEGER | primary key, autoincrement                                       |
| `started_at` | TEXT    | defaults to `CURRENT_TIMESTAMP`                                  |
| `ended_at`   | TEXT    | nullable — set by `.finish()`; null while the run is in progress |
| `status`     | TEXT    | `'running'` (default) → `'completed'` or `'failed'`              |

### `release_analysis_results`

One row per package actually classified during a run — skipped packages
(no release published, empty release body) get no row.

| column        | type    | notes                                                |
| ------------- | ------- | ---------------------------------------------------- |
| `id`          | INTEGER | primary key, autoincrement                           |
| `run_id`      | INTEGER | `REFERENCES release_analysis_runs(id)`, not null     |
| `package_id`  | INTEGER | `REFERENCES packages(id)`, not null                  |
| `release_tag` | TEXT    | e.g. `"v15.0.0"`, from the GitHub release            |
| `is_breaking` | INTEGER | `0`/`1` — the classifier's boolean, stored as an int |
| `summary`     | TEXT    | one or two sentences from the classifier             |
| `created_at`  | TEXT    | defaults to `CURRENT_TIMESTAMP`                      |

### `suggestions`

Populated by `SuggestionsRepository`, one row per version update Renovate
proposes for a dependency (see [`docs/suggestions.md`](./suggestions.md)).
A single dependency can produce more than one row (e.g. a `minor` bump and
a separate `major` bump). Unlike `call_sites`, this still stores
`dependency` as a plain name, not a `packages` foreign key — Renovate can
propose updates for packages the SBOM scan never saw (e.g. deps in a
lockfile-only manager), so it isn't guaranteed a matching `packages` row
exists. `repo_path` (same canonicalized, absolute path as `packages`) is
stored directly rather than resolved through a join, for the same reason -
there's no guaranteed `packages` row to join through.

| column            | type    | notes                                                         |
| ----------------- | ------- | ------------------------------------------------------------- |
| `id`              | INTEGER | primary key, autoincrement                                    |
| `repo_path`       | TEXT    | absolute path of the repo this suggestion was found in        |
| `dependency`      | TEXT    | package name                                                  |
| `package_file`    | TEXT    | which file it came from, e.g. `"package.json"`                |
| `dep_type`        | TEXT    | e.g. `"dependencies"` vs `"devDependencies"`                  |
| `current_version` | TEXT    | resolved version if known, else the raw range string          |
| `new_version`     | TEXT    | resolved or raw proposed version                              |
| `update_type`     | TEXT    | `"major"` / `"minor"` / `"patch"` / ...                       |
| `datasource`      | TEXT    | e.g. `"npm"`, `"docker"`, `"github-tags"`                     |
| `source_url`      | TEXT    | nullable - the package's repo/homepage, if Renovate found one |
| `scanned_at`      | TEXT    | defaults to `CURRENT_TIMESTAMP`                               |

### `pull_requests`

Populated by `PullRequestsRepository`, one row per PR
`GithubModule.openPullRequestForCodemod` actually opened (see
[`docs/github.md`](./github.md)) - not per attempt. A run that produced no
changes or found a non-GitHub remote returns `{ created: false }` without
ever reaching this table; there's no URL to record.

| column         | type    | notes                                               |
| -------------- | ------- | --------------------------------------------------- |
| `id`           | INTEGER | primary key, autoincrement                          |
| `repo_path`    | TEXT    | absolute path of the repo the PR was opened against |
| `package_name` | TEXT    | package migrated                                    |
| `version`      | TEXT    | version before the update                           |
| `new_version`  | TEXT    | version after the update                            |
| `url`          | TEXT    | the created PR's `html_url`                         |
| `opened_at`    | TEXT    | defaults to `CURRENT_TIMESTAMP`                     |

## Adding a new table

Add a `this.db.exec(\`CREATE TABLE IF NOT EXISTS ...\`)`call in`Database.migrate()`, then write a repository class next to whichever
module owns that data — inject `Database`, query through `.connection`.
Don't add table-creation or query logic to `Database`itself beyond`migrate()`; it stays a thin connection/schema wrapper.
