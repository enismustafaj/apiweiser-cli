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
  --separate-multiple-major=true   # one candidate per major, not just the latest
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

**Why `--separate-multiple-major`**: without it, Renovate offers only the
latest major (`@angular/forms 5.2.9 → 22.2.0`). With it, it offers one
candidate per major (`5.2.11, 6.1.10, 7.2.16, … 22.2.0`), so the planner can
take the next major instead (see § Picking one update per package below).
It doesn't change vulnerable packages: when OSV finds an advisory, Renovate
replaces that package's normal updates with a single security fix - the
lowest fixed version, however far away (e.g. `@angular/core 5.2.9 →
20.0.0`, since no 6.x-19.x release fixes its advisories). That's the only
candidate the planner sees for it, so the security fix wins over stepping
one major at a time.

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
`SuggestionsRepository`, plans them into groups with `UpgradePlanner`
(below), then raises a change request for each group with call sites,
before returning the updates.

## `UpgradePlanner`

`src/suggestions/group-updates.ts`. Turns Renovate's rows into the change
requests to raise: `plan(updates)` returns `{ groups, skipped }` - each
group is a set of Renovate rows that must be upgraded together (one
codemod, one install, one PR), and `skipped` lists the packages it couldn't
plan, with the reason. `UpgradePlanner.forRepo(repoPath, packages)` builds
one with its lookups (below) and a fresh registry cache, so a long-running
process never reuses registry data from a previous daily run.

### Picking one update per package

Renovate proposes several updates for the same package - a patch/minor
within the current major, plus one per major (e.g. `@angular/forms 5.2.9 →
5.2.11`, `→ 6.1.10`, ... `→ 22.2.0`). The planner keeps exactly one per
package as its starting point: the **lowest** candidate that crosses into a
new major (the next major, not the latest - migration guides and codemods
are written one major at a time, and the daily loop then proposes the next
step once this one is merged), or, if none crosses, the highest candidate
within the current major. A patch candidate is skipped when a
major-crossing one exists, since the major release already includes it.

Found the hard way: keeping more than one row per package raised competing
change requests for the same package, or put two specs for one package
into a single `npm install`, which npm can't resolve.

### Grouping by peer dependencies

Packages that peer-depend on each other have to be upgraded in the same
install - bumping one alone fails with `ERESOLVE`. Found the hard way on a
real repo: `@angular/core@20` needs `rxjs ^6.5.3 || ^7.4.0`, so upgrading
the Angular packages without `rxjs` couldn't be installed. (Grouping by npm
scope, the earlier approach, missed this: `rxjs` and `zone.js` aren't
`@angular/*`.)

`PeerGrouper` (`src/dependencies/peer/`) builds a group from one starting
package and keeps adding what the group forces in, until nothing new is
needed:

- **Forward** - the peers a member's new version needs. A peer stays out if
  its installed version already satisfies the range, or if it isn't
  installed at all (npm 7+ and pnpm install missing peers themselves).
  Otherwise it joins at its **lowest** Renovate candidate that fits. An
  optional peer (`peerDependenciesMeta`) still counts when it's installed -
  npm enforces its range then.
- **Reverse** - installed packages whose peer range rejects a member's new
  version. Each joins at its lowest Renovate candidate whose own peer range
  accepts the new version.

Versions are only ever chosen from Renovate's candidates. If no candidate
fits, the group is a **conflict**: it's skipped, with a reason naming the
package and range, e.g. `@angular/core@20.0.0 needs zone.js ~0.15.0;
installed is 0.8.20, Renovate offers [0.16.3]` (Renovate treats `0.x` as
one stream, so only the newest is offered). Greedy, no backtracking - an
earlier "lowest fitting" choice is never revisited.

The data comes from two places:

- **Installed versions** - the `packages` table (filled from the SBOM on
  every scan), via `InstalledDependencies.version`.
- **Peer ranges** - the npm registry, via `RegistryPeers.peersOf`: one
  cached request per package (the compact `application/vnd.npm.install-v1+json`
  document lists every version's peers). For the reverse check,
  `InstalledDependencies.dependentsOf` asks about every **direct**
  dependency - only those can join a group, since Renovate only suggests
  updates for them. A transitive package that peers the bumped one is
  missed; npm install then fails with `ERESOLVE`. A dependency the registry
  doesn't know (workspace, git, file, private registry) is skipped; a
  temporary registry failure (5xx, timeout) throws instead of looking like
  "no peers".

**No package ends up in two groups.** Starting points are processed in
Renovate's order. A package already pulled into an earlier group isn't
raised again. A group that would pull in a package an earlier group already
moves is skipped ("needs X, which an earlier group already moves") rather
than merged - merging correctly means rebuilding the combined group. The
next daily run plans it again against the new installed state.

If the registry fails while building one package's group, only that
package is skipped ("couldn't check peers: …"). Since the reverse check
asks about every direct dependency, a failure for one of those affects
every package in that run - the next daily run retries.

### Raising change requests

No separate breaking/not-breaking gate anymore - see
[`docs/data-sources.md`](./data-sources.md) § Changelog summarization for
why the old classify-the-latest-release-once-a-day design was replaced
(it measurably missed real breaking changes on two separate test repos).
For each group from above:

1. `CallSitesRepository.findForDependency` runs for every member of the
   group and the results are combined - empty overall means nothing for a
   codemod to migrate anywhere in the group, so this returns immediately
   without ever fetching a changelog or summarizing anything. That's also
   what skips devDependencies: they're never scanned for call sites (see
   [`docs/scanner.md`](./scanner.md) § devDependencies aren't scanned at
   all), so an all-devDependency group always comes back empty. A
   devDependency grouped with a runtime package that has call sites (a
   peer it needs) still gets bumped with it. Checked here, not just inside
   `ChangeRequestsModule.create` (which has the same check for defense in
   depth - see [`docs/change-requests.md`](./change-requests.md)),
   specifically to avoid the wasted network/LLM calls, not just the wasted
   agent session.
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
   sites, and the combined summary - `repoPath` is what
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
