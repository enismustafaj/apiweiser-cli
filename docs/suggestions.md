# Suggestions

`src/suggestions/` — proposes version updates for a repo's dependencies via
Renovate, and can do so on a recurring cron schedule.

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
_before_ that step runs, so the non-zero exit is caught and logged at
`console.debug` (in case it's ever something else) rather than thrown -
the failure is swallowed (logged at debug level in case it's ever something
else) and the code moves on to read the report file regardless. If the
report is genuinely missing or malformed — Renovate itself failed, not just
the local-platform quirk — `JSON.parse(await readFile(reportPath, ...))`
throws on its own right after, so real failures still surface.

**Caching**: the raw report JSON is cached under
`~/.apiweiser-cli/renovate/<hash-of-repopath>.json`, same pattern as
`SbomTool`'s SBOM cache — a directory dedicated to this CLI, keyed by a hash
of the resolved repo path so multiple repos don't collide.

**Important:** Renovate's `local` platform discovers files via `git
ls-files` — only _committed_ files are seen. An untracked `package.json`
scans as zero dependencies with no error or warning.

### Flattening the report

Renovate's report nests four levels deep: `repositories`, keyed by repo
name, each holding `packageFiles`, keyed by manager, each an array of
`{ packageFile, deps }`, each `dep` carrying its own array of proposed
`updates`.

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

Thin orchestrator, same shape as `DependenciesModule`: `generate(repoPath)`
runs `RenovateTool`, inserts the resulting updates via
`SuggestionsRepository`, then raises a change request for each one that
turns out to be breaking (below), before returning the updates.

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
passing `repoPath` along with the package's current call sites
(`CallSitesRepository.findForDependency`) — `repoPath` is what
`GithubModule` (see [`docs/github.md`](./github.md)) applies a successful
codemod to and opens a PR against. Awaited, one at a time (not
`Promise.all`'d) — each one spawns a full coding agent session, and running
several concurrently would be its own rate-limit/cost problem, same
reasoning as `ReleaseAnalysisModule`'s pacing. Wrapped in try/catch and
logged on failure, same resilience pattern as everywhere else in this CLI,
so one failed codemod attempt doesn't crash the rest of `generate()`. Needs
`codingAgent` and `github` filled in in config (see
[`docs/config.md`](./config.md)) — `SuggestionsModule`'s constructor takes
both directly.

## `Scheduler`

Wraps `node-cron` so `SuggestionsModule.generate` can run on a recurring
schedule instead of once - constructed with `repoPath`, a cron expression
(e.g. every day at 09:00), and the coding-agent/GitHub config, then
`.start()`/`.stop()`. Built with `createTask` (not `schedule`) specifically so the task exists but
sits idle until `.start()` is called — `Scheduler.start()`/`.stop()` map
directly onto it. Each tick calls a private `run()` that catches and
`console.error`s any failure, so one bad run (network blip, Renovate crash,
whatever) doesn't kill the whole schedule.

## CLI

Not behind a flag - `main.ts` always constructs and starts this
`Scheduler` too, with a fixed once-a-day cron (`"0 0 * * *"`; the class
itself still takes any expression, see above), last among the three
schedulers it starts (after the changelog-lookup and release-analysis
ones - see [`docs/data-sources.md`](./data-sources.md)). `--path` always
runs `DependenciesModule.scan` once first; `SuggestionsScheduler` is
constructed with that same `repoPath`.
