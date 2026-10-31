# Plan

`apiweiser-cli plan --path <repo> [--package <name>]...` - runs Renovate on a
scanned repo, groups the available updates into sets of packages that must
move together, and prints them as JSON (see `plan` in
`skills/upgrade-dependency/SKILL.md` for the full output and how the agent reads it):

```json
{
  "repo": "/abs/path",
  "groups": [
    {
      "id": "react@19.0.0+react-dom@19.0.0",
      "packages": [
        {
          "name": "react",
          "from": "18.3.1",
          "to": "19.0.0",
          "updateType": "major",
          "callSites": 12,
          "vulnerabilities": []
        }
      ]
    }
  ],
  "skipped": [{ "name": "eslint", "reason": "...", "vulnerabilities": [] }]
}
```

- **`id`** - the members' `name@to`, sorted by name and joined with `+`. The
  same input always gives the same id, so `changelog` and `codemod` take it
  as `--group` without `plan` storing anything.
- **`from`** - the installed version `scan` recorded, not Renovate's
  `currentVersion`: Renovate reports the range's newest match when it can't
  read the lockfile (vitesse's old pnpm lockfile: pinia 2.3.1 from the
  range, 2.0.11 installed), and `changelog`/`codemod` use the installed one.
- **`--package`** - keeps only the groups and skipped entries that mention
  one of the named packages; the shape stays the same.
- **`vulnerabilities`** - below.

A repo that was never scanned fails the command: the peer checks read
installed versions from the `packages` table.

## Vulnerabilities

`OsvClient` (`src/vulnerabilities/`) asks [OSV.dev](https://osv.dev) about
every package in the plan at its installed version: one `POST
/v1/querybatch` (advisory ids only), then one `GET /v1/vulns/{id}` per
distinct advisory for its summary, severity (GitHub's rating) and fixed
versions. No token needed.

`fixedIn` is the lowest `fixed` event above the installed version across
the package's ranges - an advisory can be fixed separately per major line
(4.17.3 and 5.0.1), and the nearest fix is the useful one. It can be beyond
`to`: the planner still steps one major at a time, and the agent keeps
stepping until it reaches `fixedIn` (see § Why no
`--osv-vulnerability-alerts`). `[]` means no advisories; `null` means the
lookup failed - the plan still succeeds.

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
  --enabled-managers=npm        # only package.json dependencies
  --separate-multiple-major=true   # one candidate per major, not just the latest
  --report-type=file
  --report-path=<cache file>
```

run with `cwd: repoPath` and `LOG_LEVEL=error` (its logs aren't parsed, only
the report file is).

**Why no `--osv-vulnerability-alerts`**: with it, Renovate replaces a
vulnerable package's normal updates with a single security fix - the lowest
fixed version, however far away. Packages that must move together can then
never line up: nest-starter's `@nestjs/common` and `@nestjs/core` 7.6.15
have different advisories, fixed in 10.4.16 and 11.1.18, while
`@nestjs/testing` (no advisory) offered 8, 9, 10, … - no version in common,
so every `@nestjs/*` package was skipped. Vulnerabilities are looked up
separately, from OSV.dev, and reported by `plan` next to each package
instead of choosing its version (see `plan` in skills/upgrade-dependency/SKILL.md).

**Why `--enabled-managers=npm`**: found the hard way, running this against
a real repo - without it, Renovate also proposes updates for things this
CLI has no business touching, like the Node.js runtime version itself
(detected from `.nvmrc`/`engines.node`, `datasource: "node-version"`).
That "dependency" isn't a `dependencies`/`devDependencies` entry at all, so
Renovate's own report gives it no `depType`, which crashed the code that
stored suggestions at the time. Restricting to the `npm` manager keeps
Renovate to exactly what this tool is built to handle: `package.json`
dependencies.

**Why `--separate-multiple-major`**: without it, Renovate offers only the
latest major (`@angular/forms 5.2.9 → 22.2.0`). With it, it offers one
candidate per major (`5.2.11, 6.1.10, 7.2.16, … 22.2.0`), so the planner can
take the next major instead (see § Picking one update per package below).

**Why the report file, not stdout/logs**: `--report-type=file` is Renovate's
own stable, structured output — the same data other Renovate integrations
consume — rather than us scraping log lines that could change wording
between versions.

**Why the process's exit code is ignored**: on `--platform=local`, Renovate
reliably fails a later step (writing update branches) even on a totally
successful scan, because that platform mode can't push branches — a
`platform=local` limitation, not a real error. The report file is written
_before_ that step runs, so the non-zero exit is caught and logged at
debug level (in case it's ever something else) rather than thrown -
the failure is swallowed (logged at debug level in case it's ever something
else) and the code moves on to read the report file regardless. If the
report is genuinely missing or malformed — Renovate itself failed, not just
the local-platform quirk — `JSON.parse(await readFile(reportPath, ...))`
throws on its own right after, so real failures still surface.

**Report location**: the raw report JSON is written to
`~/.apiweiser-cli/renovate/<hash-of-repopath>.json` — a directory dedicated
to this CLI, keyed by a hash of the resolved repo path so multiple repos
don't collide. It's rewritten on every `plan`.

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

## `UpgradePlanner`

`src/suggestions/group-updates.ts`. Turns Renovate's rows into `plan`'s
groups: `plan(updates)` returns `{ groups, skipped }` - each group is a set
of Renovate rows that must be upgraded together (one install), and
`skipped` lists the packages it couldn't plan, with the reason.
`UpgradePlanner.forRepo(repoPath, packages)` builds one with its lookups
(below) and a fresh registry cache.

### Picking one update per package

Renovate proposes several updates for the same package - a patch/minor
within the current major, plus one per major (e.g. `@angular/forms 5.2.9 →
5.2.11`, `→ 6.1.10`, ... `→ 22.2.0`). The planner keeps exactly one per
package as its starting point: the **lowest** candidate that crosses into a
new major (the next major, not the latest - migration guides and codemods
are written one major at a time, and the next `plan` proposes the next
step once this one is done), or, if none crosses, the highest candidate
within the current major. A patch candidate is skipped when a
major-crossing one exists, since the major release already includes it.

Found the hard way: keeping more than one row per package put the same
package in competing groups, or put two specs for one package into a single
`npm install`, which npm can't resolve.

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

- **Installed versions** - the `packages` table (filled from `node_modules`
  on every `scan`), via `InstalledDependencies.version`.
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
next `plan` plans it again against the new installed state.

If the registry fails while building one package's group, only that
package is skipped ("couldn't check peers: …"). Since the reverse check
asks about every direct dependency, a failure for one of those affects
every package in that run - the next `plan` retries.
