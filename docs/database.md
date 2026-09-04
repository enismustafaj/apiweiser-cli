# Database

`src/db/database.ts` — the CLI's sqlite database: one connection, opened
once, shared by every module.

- **File location**: `~/.apiweiser-scanner/db.sqlite` — a directory
  dedicated to this CLI, separate from any repo being scanned (same idea as
  the SBOM/Renovate report caches).
- **Engine**: Node's stdlib `node:sqlite` (`DatabaseSync`), not a
  third-party package.
- **Access pattern**: `Database` owns the connection and schema; it doesn't
  know about `packages`, `call_sites`, `data_sources`, or `suggestions` as
  domain concepts beyond creating their tables. Each module has its own
  `*Repository` class (`PackagesRepository`, `CallSitesRepository`,
  `DataSourcesRepository`, `SuggestionsRepository`) that takes a `Database`
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
  `~/.apiweiser-scanner/db.sqlite` file. When that side effect lived in
  `database.ts`, every test file that imported the class triggered it too,
  and concurrent test runs raced to open and migrate the same real file.
  `database.ts` now only exports the `Database` class — no side effects on
  import.

## Schema

All tables are created with `CREATE TABLE IF NOT EXISTS` in
`Database.migrate()`, run once in the constructor — there's no separate
migration runner or versioning, just idempotent `CREATE TABLE`s. Changing an
existing table's columns means deleting `~/.apiweiser-scanner/db.sqlite`
and letting it recreate; there's no `ALTER TABLE` step.

### `packages`

Populated by `PackagesRepository`, **one row per distinct package name** —
this is a dimension/reference table, not an event log. Re-scanning a repo
`UPSERT`s (`ON CONFLICT(name) DO UPDATE`) rather than inserting new rows, so
`current_version`/`type` always reflect the most recent scan.

`upsert()` uses `... RETURNING id` and writes the result straight onto each
`Dependency` object's `id` field, in the same statement as the
insert/update — no separate `SELECT` afterward. Downstream code that
already has the (now-mutated) `Dependency` in hand, like
`DataSourcesRepository`, uses `dependency.id` directly instead of looking
the id up again by name. `CallSitesRepository` is the exception — see the
`call_sites` note below.

| column            | type    | notes                                    |
| ----------------- | ------- | ---------------------------------------- |
| `id`              | INTEGER | primary key, autoincrement               |
| `name`            | TEXT    | package name, unique, e.g. `"commander"` |
| `current_version` | TEXT    | from the SBOM                            |
| `type`            | TEXT    | `"direct"` or `"transitive"`             |

### `call_sites`

Populated by `CallSitesRepository`, one row per place a scanned
dependency's API is actually called (see [`docs/scanner.md`](./scanner.md)
for how `Scanner` finds these). `package_id` is a foreign key into
`packages` — `DependenciesModule` always upserts packages first, so the
package a call site belongs to is guaranteed to exist by the time the call
site is inserted. Unlike `data_sources` below, `CallSitesRepository` still
resolves `package_id` via a `(SELECT id FROM packages WHERE name = ?)`
subquery rather than `dependency.id` — `CallSite` only carries the
dependency's name (from `Scanner`, which doesn't touch the database), not
the `Dependency` object itself, so there's no `id` on hand to reuse.

| column        | type    | notes                                                  |
| ------------- | ------- | ------------------------------------------------------ |
| `id`          | INTEGER | primary key, autoincrement                             |
| `package_id`  | INTEGER | `REFERENCES packages(id)`, not null                    |
| `file`        | TEXT    | absolute path of the source file                       |
| `line`        | INTEGER | 1-based line of the call                               |
| `snippet`     | TEXT    | source text of the resolved call/`new` expression      |
| `api_surface` | TEXT    | member invoked, e.g. `"Command"` or `"Command.option"` |
| `scanned_at`  | TEXT    | defaults to `CURRENT_TIMESTAMP`                        |

To read a call site with its package name, join through `package_id`:

```sql
SELECT p.name AS dependency, cs.file, cs.line, cs.api_surface
FROM call_sites cs
JOIN packages p ON p.id = cs.package_id
```

### `data_sources`

Populated by `DataSourcesRepository`, one row per package `DataSourcesModule`
found a changelog source for (see
[`docs/data-sources.md`](./data-sources.md)). Only ever written for
packages that are brand new to `packages` — a version bump on a package
already known doesn't produce a new row here.

| column       | type    | notes                                          |
| ------------ | ------- | ---------------------------------------------- |
| `id`         | INTEGER | primary key, autoincrement                     |
| `package_id` | INTEGER | `REFERENCES packages(id)`, not null            |
| `url`        | TEXT    | GitHub releases page or raw `CHANGELOG.md` URL |
| `created_at` | TEXT    | defaults to `CURRENT_TIMESTAMP`                |

`DataSourcesRepository.insert()` takes `Map<packageId, url>` and inserts
`package_id` directly — no subquery, since `DataSourcesModule` already has
each `Dependency`'s `id` (set by `PackagesRepository.upsert()`) on hand.

### `suggestions`

Populated by `SuggestionsRepository`, one row per version update Renovate
proposes for a dependency (see [`docs/suggestions.md`](./suggestions.md)).
A single dependency can produce more than one row (e.g. a `minor` bump and
a separate `major` bump). Unlike `call_sites`, this still stores
`dependency` as a plain name, not a `packages` foreign key — Renovate can
propose updates for packages the SBOM scan never saw (e.g. deps in a
lockfile-only manager), so it isn't guaranteed a matching `packages` row
exists.

| column            | type    | notes                                                         |
| ----------------- | ------- | ------------------------------------------------------------- |
| `id`              | INTEGER | primary key, autoincrement                                    |
| `dependency`      | TEXT    | package name                                                  |
| `package_file`    | TEXT    | which file it came from, e.g. `"package.json"`                |
| `dep_type`        | TEXT    | e.g. `"dependencies"` vs `"devDependencies"`                  |
| `current_version` | TEXT    | resolved version if known, else the raw range string          |
| `new_version`     | TEXT    | resolved or raw proposed version                              |
| `update_type`     | TEXT    | `"major"` / `"minor"` / `"patch"` / ...                       |
| `datasource`      | TEXT    | e.g. `"npm"`, `"docker"`, `"github-tags"`                     |
| `source_url`      | TEXT    | nullable - the package's repo/homepage, if Renovate found one |
| `scanned_at`      | TEXT    | defaults to `CURRENT_TIMESTAMP`                               |

## Adding a new table

Add a `this.db.exec(\`CREATE TABLE IF NOT EXISTS ...\`)`call in`Database.migrate()`, then write a repository class next to whichever
module owns that data — inject `Database`, query through `.connection`.
Don't add table-creation or query logic to `Database`itself beyond`migrate()`; it stays a thin connection/schema wrapper.
