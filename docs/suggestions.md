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
  --osv-vulnerability-alerts=true  # check OSV.dev for known vulnerabilities too
  --enabled-managers=npm        # only package.json dependencies
  --report-type=file
  --report-path=<cache file>
```

run with `cwd: repoPath` and `LOG_LEVEL=error` (its logs aren't parsed, only
the report file is).

**Why `--osv-vulnerability-alerts`**: Renovate's normal vulnerability alerts
come from the git host (e.g. GitHub's Dependabot advisories), which
requires a host token - not available on `--platform=local`, which has no
host at all. OSV.dev needs no host auth, so enabling this is what lets a
vulnerable dependency surface as a proposed update here at all.

**Why `--enabled-managers=npm`**: found the hard way, running this against
a real repo - without it, Renovate also proposes updates for things this
CLI has no business touching, like the Node.js runtime version itself
(detected from `.nvmrc`/`engines.node`, `datasource: "node-version"`).
That "dependency" isn't a `dependencies`/`devDependencies` entry at all, so
Renovate's own report gives it no `depType` - and
`SuggestionsRepository.insert()` crashed trying to bind that missing value
into a `NOT NULL` column. Restricting to the `npm` manager keeps Renovate
to exactly what this pipeline is built to handle: `package.json`
dependencies.

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
`SuggestionsRepository`, groups them (below), then raises a change request
for each group that's either a real dependency with call sites or a
devDependency, before returning the updates.

### Grouping scoped packages

`groupByScope` puts every update sharing an npm scope (`@angular/core`,
`@angular/router`, ... → `@angular`) into one group, before anything else
runs - a group of one (an unscoped package, or a scope with only one
update) behaves identically to today. Found the hard way, running the full
pipeline against a real repo: Renovate proposed `@angular/common`,
`@angular/core`, `@angular/router`, and `@angular/platform-browser-dynamic`
as four independent updates, and raising four independent change requests
meant four independent `npm install @angular/x@20.0.0` calls - each one
failed with a peer-dependency `ERESOLVE`, because Angular's own packages
peer-depend on their scope-siblings at the exact same version, and nothing
had bumped the others yet. A group becomes **one** `ChangeRequestInput`
with `packages: ChangeRequestPackage[]` (combined call sites, combined
changelog summary, one coding-agent session, one PR - see
[`docs/change-requests.md`](./change-requests.md)) instead of one per
package.

**`@types/*` is excluded on purpose** - it's the one common scope where
grouping would be wrong. Unlike `@angular/*`, `@types/react` and
`@types/node` have nothing to do with each other's version numbers or
install requirements; they're independent packages that merely happen to
publish under the same DefinitelyTyped-managed scope.

### Raising change requests

No separate breaking/not-breaking gate anymore - see
[`docs/data-sources.md`](./data-sources.md) § Changelog summarization for
why the old classify-the-latest-release-once-a-day design was replaced
(it measurably missed real breaking changes on two separate test repos).
For each group from above:

1. `update.depType === "devDependencies"`, checked across **every** member
   of the group (`isDevDependency` is true only if all of them are),
   decides whether call sites are even checked. devDependencies are never
   scanned for call sites at all (see [`docs/scanner.md`](./scanner.md) §
   devDependencies aren't scanned at all) -
   `callSitesRepository.findForDependency` would always come back empty
   for one, so this skips straight to step 2 with `callSites: []` rather
   than pretending to check. Otherwise, `CallSitesRepository.findForDependency`
   runs for every member of the group and the results are combined - empty
   overall means nothing for a codemod to migrate anywhere in the group, so
   this returns immediately without ever fetching a changelog or
   summarizing anything. Checked here, not just inside
   `ChangeRequestsModule.create` (which has the same check for defense in
   depth, minus the devDependency exception - see
   [`docs/change-requests.md`](./change-requests.md)), specifically to
   avoid the wasted network/LLM calls, not just the wasted agent session.
2. `ChangelogSummarizer.summarize(dependency, currentVersion, newVersion)`
   (see [`docs/data-sources.md`](./data-sources.md)) - fetches and
   summarizes the real changelog for the exact range Renovate proposed,
   **once per member of the group**, each wrapped in its own try/catch so
   one member's failure (an unresolvable changelog source, a 404 on a
   renamed repo) doesn't lose the others - the combined summary is
   whichever members actually resolved, under a `## <dependency>` heading
   each when the group has more than one member. If every member comes
   back `null`/failed, nothing is raised.
3. Otherwise, raises a change request via `ChangeRequestsModule.create`
   (see [`docs/change-requests.md`](./change-requests.md)), passing
   `repoPath`, `packages` (one entry per group member), the combined call
   sites (`[]` for an all-devDependency group), whether the whole group is
   a devDependency group, and the combined summary - `repoPath` is what
   `GithubModule` (see [`docs/github.md`](./github.md)) applies a
   successful codemod to and opens a PR against. The coding agent itself
   decides whether anything actually needs to change (same resilience
   path as any other suggestion that turns out to need no code changes,
   e.g. a repo that doesn't call a package's API directly - see
   [`docs/change-requests.md`](./change-requests.md)).

Awaited, one group at a time (not `Promise.all`'d) — each one can spawn a
full coding agent session, and running several concurrently would be its
own rate-limit/cost problem. Wrapped in try/catch and logged on failure,
same resilience pattern as everywhere else in this CLI, so one failed
attempt doesn't crash the rest of `generate()`. Needs `llm`, `codingAgent`,
and `github` filled in in config (see [`docs/config.md`](./config.md)) -
`SuggestionsModule`'s constructor takes all three directly.

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
itself still takes any expression, see above), after the changelog-lookup
scheduler (see [`docs/data-sources.md`](./data-sources.md)). `--path`
always runs `DependenciesModule.scan` once first; `SuggestionsScheduler` is
constructed with that same `repoPath`.
