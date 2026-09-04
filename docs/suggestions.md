# Suggestions

`src/suggestions/` — proposes version updates for a repo's dependencies via
Renovate, and can do so on a recurring cron schedule.

```
src/suggestions/
  types.ts                      RenovateUpdate
  tool/renovate-report.ts       raw shape of Renovate's own JSON report
  tool/renovate-tool.ts         class RenovateTool  - subprocess to `npx renovate`
  db/suggestions-repository.ts  class SuggestionsRepository(db)
  index.ts                      class SuggestionsModule - wires the two together
  suggestions-scheduler.ts      class Scheduler(repoPath, cronExpr)
```

## `RenovateTool`

`RenovateTool.run(repoPath): Promise<RenovateUpdate[]>`

Shells out to Renovate's own CLI, via `npx --yes renovate` rather than a
project dependency — Renovate is a huge tool, this only ever _calls_ it, it
doesn't import it as a library.

```
npx --yes renovate
  --platform=local              # scan repoPath itself, no git host/token needed
  --dry-run=full                # never actually create branches/PRs
  --onboarding=false            # skip the "add a renovate.json" flow
  --require-config=optional     # don't require a renovate.json to exist
  --dependency-dashboard=false  # skip the dashboard issue workflow
  --report-type=file
  --report-path=<cache file>
```

run with `cwd: repoPath` and `LOG_LEVEL=error` (its logs aren't parsed, only
the report file is).

**Why the report file, not stdout/logs**: `--report-type=file` is Renovate's
own stable, structured output — the same data other Renovate integrations
consume — rather than us scraping log lines that could change wording
between versions.

**Why the process's exit code is ignored**: on `--platform=local`, Renovate
reliably fails a later step (writing update branches) even on a totally
successful scan, because that platform mode can't push branches — a
`platform=local` limitation, not a real error. The report file is written
_before_ that step runs, so:

```ts
try {
  await execFileAsync("npx", [...]);
} catch (err) {
  console.debug("renovate exited non-zero (ignored, trusting the report file):", err);
}
```

the failure is swallowed (logged at debug level in case it's ever something
else) and the code moves on to read the report file regardless. If the
report is genuinely missing or malformed — Renovate itself failed, not just
the local-platform quirk — `JSON.parse(await readFile(reportPath, ...))`
throws on its own right after, so real failures still surface.

**Caching**: the raw report JSON is cached under
`~/.apiweiser-scanner/renovate/<hash-of-repopath>.json`, same pattern as
`SbomTool`'s SBOM cache — a directory dedicated to this CLI, keyed by a hash
of the resolved repo path so multiple repos don't collide.

**Important:** Renovate's `local` platform discovers files via `git
ls-files` — only _committed_ files are seen. An untracked `package.json`
scans as zero dependencies with no error or warning.

### Flattening the report

Renovate's report nests four levels deep:

```
repositories → { [repoName]: { packageFiles: { [manager]: [ { packageFile, deps: [ { ...dep, updates: [...] } ] } ] } } }
```

`toUpdates()` walks all four levels and emits one `RenovateUpdate` per
`(dep, update)` pair — not per dependency. A single dependency can have
_multiple_ proposed updates (e.g. a `minor` bump and a separate `major`
bump, if you're several majors behind), each becoming its own row.

Two fields fall back between Renovate's _resolved_ and _raw_ forms, because
not every datasource lets Renovate resolve an exact version:

- `currentVersion ?? currentValue` — resolved version (`10.0.1`) if known,
  else the raw range string from the file (`^10.0.0`).
- `newVersion ?? newValue` — same idea for the proposed version.

## `SuggestionsRepository`

`SuggestionsRepository.insert(updates: RenovateUpdate[]): void`

Takes a `Database` injected via constructor (the shared singleton in normal
use, see [`db/database.ts`](../src/db/database.ts)) and inserts into the
`suggestions` table:

| column            | source                                             |
| ----------------- | -------------------------------------------------- |
| `dependency`      | `dep.depName`                                      |
| `package_file`    | which file it came from, e.g. `package.json`       |
| `dep_type`        | e.g. `dependencies` vs `devDependencies`           |
| `current_version` | resolved or raw current version                    |
| `new_version`     | resolved or raw proposed version                   |
| `update_type`     | `major` / `minor` / `patch` / ...                  |
| `datasource`      | e.g. `npm`, `docker`, `github-tags`                |
| `source_url`      | the package's repo/homepage, if Renovate found one |
| `scanned_at`      | defaulted by sqlite to `CURRENT_TIMESTAMP`         |

The table is created (`CREATE TABLE IF NOT EXISTS`) by `Database.migrate()`
alongside `call_sites` — schema lives centrally in `Database`, repositories
only run queries against `db.connection`.

## `SuggestionsModule`

Thin orchestrator, same shape as `DependenciesModule`:

```ts
async generate(repoPath: string): Promise<RenovateUpdate[]> {
  const updates = await this.renovateTool.run(repoPath);
  this.suggestionsRepository.insert(updates);

  for (const update of updates) {
    this.raiseChangeRequestIfBreaking(update);
  }

  return updates;
}
```

### Raising change requests for breaking updates

For each update Renovate proposes, checks whether its `newVersion` was
already classified by `ReleaseAnalysisModule` (see
[`docs/data-sources.md`](./data-sources.md) § Release analysis) —
`ReleaseAnalysisRepository.findResult(dependency, newVersion)` looks up
`release_analysis_results` by package name and matches `release_tag`
against both `newVersion` and `v${newVersion}` (GitHub tags are often
`v`-prefixed, Renovate's version isn't). No match (not classified yet, or
no `data_sources` entry at all) means nothing happens — silently, since an
update simply not yet analyzed isn't an error.

If a match says `isBreaking`, raises a change request via
`ChangeRequestsModule.create` (see [`docs/change-requests.md`](./change-requests.md)),
attaching the package's current call sites
(`CallSitesRepository.findForDependency`) so whoever handles the change
request can see what actually calls the package. `create()` is not
implemented yet — the call is wrapped in try/catch and logs on failure,
same resilience pattern as everywhere else, so this doesn't crash
`generate()` for real matches until change-requests lands.

## `Scheduler`

Wraps `node-cron` so `SuggestionsModule.generate` can run on a recurring
schedule instead of once:

```ts
new Scheduler(repoPath, "0 9 * * *"); // e.g. every day at 09:00
scheduler.start();
scheduler.stop();
```

Built with `createTask` (not `schedule`) specifically so the task exists but
sits idle until `.start()` is called — `Scheduler.start()`/`.stop()` map
directly onto it. Each tick calls a private `run()` that catches and
`console.error`s any failure, so one bad run (network blip, Renovate crash,
whatever) doesn't kill the whole schedule.

## CLI

```
node src/main.ts --path <repo> --suggestions-cron "<cron expression>"
```

`--path` always runs `DependenciesModule.scan` once. `--suggestions-cron` is
optional; when given, it additionally starts the `Scheduler` — the process
then keeps running, ticking on schedule, instead of exiting after the
one-off scan.
