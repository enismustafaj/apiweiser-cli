# GitHub

`src/github/` — turns a successfully-generated, already-tested codemod
package (see [`docs/change-requests.md`](./change-requests.md)) into an
actual PR against the repo being monitored: apply it for real, and - only
if it actually changed something - branch, commit, push, and open a PR
describing the migration.

## `CloneTool` / `RepoCloner` - getting a repo onto disk at all

`apiweiser-cli scan` takes exactly one of `--path <path>` (a repo already
checked out locally) or `--repo <url>` (a git URL to clone). A separate
class from `GitTool` below - `GitTool`'s methods all assume the repo is
already checked out (they run `git ... ` with `cwd: repoPath`), which isn't
true yet for a fresh `--repo` invocation. `CloneTool.clone(url, destDir)`/
`.pull(repoPath)` are authenticated exactly the same way `GitTool.push()`
is (see below) - factored into a shared `gitAuthEnv(token)` helper
(`git-auth.ts`) so the header logic isn't duplicated between the two
classes.

`RepoCloner.cloneOrPull(url)` is what `main.ts` actually calls: picks a
stable local directory - `~/.apiweiser-cli/repos/<owner>-<repo>/`, readable
rather than hashed like the SBOM/Renovate caches, since this directory
_is_ the working tree everything else in the CLI (`Scanner`, `GitTool`,
`CodemodApplier`, ...) operates on, not just an internal cache file - and
either clones fresh (first time this URL is seen) or pulls latest (every
run after that, so re-running the CLI against the same `--repo` doesn't
re-clone from scratch). Returns the local path; everything downstream
(`DependenciesModule`, the schedulers, `GithubModule`) only ever sees a
`repoPath` and has no idea whether it came from `--path` or a clone.

**Resetting before every pull, and before every PR attempt**: found the
hard way, running this against a real repo end-to-end -
`GithubModule.openPullRequestForCodemod` leaves the clone checked out on a
PR feature branch (`GitTool.createBranch`/`.commitAll` never switch back to
the default branch on their own). Two different symptoms, two call sites
for the same fix (`GitTool.resetToDefaultBranch(repoPath)` - checks out the
default branch, `git reset --hard origin/<branch>`, `git clean -fd`):

- **Across CLI runs**: a plain `git pull` on the _next_ run would pull
  _that_ feature branch, not the default one - so a later codemod would run
  against already-modified code instead of a clean checkout, and a re-run
  for the _same_ package would silently find "no changes" for the wrong
  reason (the migration was already there, not because it was correctly
  detected as already covered). Fixed by running this before every
  `RepoCloner.pull()`, not just the first clone.
- **Within a single run**: `SuggestionsModule.generate()` calls
  `openPullRequestForCodemod` once per change request against the _same_
  `repoPath`, one after another. Without resetting first, the second call's
  `createBranch` branches off the _first_ call's feature branch instead of
  the base - every PR after the first one silently accumulates every prior
  PR's changes too. Verified for real: a PR meant to be "upgrade
  typescript" also contained an unrelated "upgrade concurrently" diff from
  the change request raised just before it in the same run. Fixed by
  running the same reset at the top of `openPullRequestForCodemod` itself,
  not just at the start of a fresh clone.

This cache directory is disposable; it's never a place to keep work.

**Installing dependencies is a separate step, not `RepoCloner`'s job**:
`SbomTool`'s `npm sbom` (see [`docs/scanner.md`](./scanner.md)) needs
`node_modules` actually installed, which a fresh clone doesn't have - but
that's a dependencies-module concern, not a git-cloning one.
`DependencyInstaller.install(repoPath)` (`src/dependencies/tool/`, next to
`SbomTool`) runs `npm install --legacy-peer-deps` - a no-op if there's no
`package.json` - and `main.ts` calls it explicitly right after
`cloneOrPull`, only for the `--repo` path. A `--path` repo is assumed to
already have its own dependencies installed by the user; running
`npm install` against it unasked would mutate a repo this CLI doesn't own.

**`--legacy-peer-deps`**: found the hard way, cloning a real dormant repo -
npm 7+ rejects a peer conflict outright by default (a real one hit:
`react@17` vs `mobx-react@5.4.4`'s peer range capping at `react@16`, which
installed fine for years under npm 6, which only warned). A repo this old
and unmaintained is exactly the kind this CLI most needs to handle, so
failing to even install it isn't acceptable - this flag restores npm 6's
"warn, don't block" behavior, since the goal here is installing the repo's
dependencies as they actually are, not fixing them.

**Trust model, same as everywhere else in this CLI**: `ConfigLoader` only
checks that `github.token` is _present_, never that it's actually a valid
credential (same for `llm.apiKey`) - so a garbage or expired token breaks
`clone()` even against a fully public repo, the same way it would already
break `push()`/PR creation today. No fallback to an unauthenticated clone
attempt; a token the user configured is trusted to be real.

## `DependencyBumper.bump(repoPath, packageName, newVersion)` / `.bumpAll(repoPath, packages)`

Found missing the hard way: applying the chalk v4→v5 codemod to a real
dependent produced a PR that migrated call-site syntax to v5's API but
still declared `chalk: "^4.1.0"` in `package.json` - the installed v4
doesn't have the named exports the migrated code now imports, so the PR
didn't even compile. `CodemodApplier`'s transform only touches source
files (an AST-based tool has no business editing package manifests or
running installs), so this is a separate, deterministic step:

1. Skips a package entirely if it isn't declared in `dependencies` or
   `devDependencies` in the target repo's `package.json` - nothing to
   bump (also skips `peerDependencies`; bumping a peer range without the
   consuming project's own say-so is a bigger call than this pipeline
   should make unattended).
2. Detects the target repo's package manager by lockfile presence
   (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm) and runs that
   manager's own `add`/`install` command (`npm install <pkg>@<version>`,
   `yarn add <pkg>@<version>`, `pnpm add <pkg>@<version>`, `--save-dev`/
   `--dev` if it was a devDependency) - this updates `package.json` _and_
   the lockfile together, correctly, rather than hand-editing JSON and
   hoping the lockfile stays consistent.

`bump()` is `bumpAll()` for a single package. `bumpAll()` is what
`GithubModule` actually calls - all declared packages in the group are
installed **in one command per section** (one call for the
`dependencies` members, a separate one for any `devDependencies`
members), not one call per package. Found the hard way, running the full
pipeline against a real repo: `npm install @angular/common@20.0.0` alone
fails with a peer-dependency `ERESOLVE`, because `@angular/common@20`
peer-depends on `@angular/core@20` - and the repo's `@angular/core` was
still on `5.x`, since nothing had bumped it yet. Giving npm every
scope-sibling in the same `npm install` call lets it resolve the whole
family's peer graph together instead of failing on the first package one
at a time. See [`docs/suggestions.md`](./suggestions.md) § Grouping scoped
packages for where these groups come from.

Not covered by an automated test beyond the "nothing declared, stay a
no-op" guard - the actual install is network-bound, same reasoning as
`RenovateTool` (see [`docs/suggestions.md`](./suggestions.md)). Verified in
practice: running this against the `ts-loader` PR above (bump to
`chalk@^5.0.0`, `yarn install`) turned a non-compiling PR into one that
passes `tsc --noEmit` cleanly from a fresh clone.

## `CodemodApplier.apply(codemodPath, targetRepoPath)`

Runs the codemod CLI's own workflow runner - the same tool used to build
and test the package in the first place - against the real target repo:

```
npx --yes codemod workflow run
  -w <codemodPath>/workflow.yaml
  -t <targetRepoPath>
  --no-interactive
  --allow-dirty   # the target repo may already have unrelated local changes
  --allow-fs
```

This only produces working-tree changes; nothing is committed here.

## `GitTool`

Thin wrapper over the `git` CLI, one method per step:

- `hasChanges(repoPath)` — `git status --porcelain` is non-empty
- `createBranch(repoPath, branch)` — `git checkout -b <branch>`
- `commitAll(repoPath, message)` — `git add -A && git commit -m <message>`
- `push(repoPath, branch)` — `git push -u origin <branch>`, authenticated
  (see below)
- `defaultBranch(repoPath)` — `git symbolic-ref --short refs/remotes/origin/HEAD`,
  falls back to `"main"` if that ref doesn't exist (e.g. a shallow clone)
- `resetToDefaultBranch(repoPath)` — checks out `defaultBranch(repoPath)`,
  `git reset --hard origin/<branch>`, `git clean -fd`. Used by `RepoCloner`
  (above) before every `pull()`, not by the PR-opening flow itself
- `remoteRepo(repoPath)` — `git remote get-url origin`, parsed down to
  `{ owner, repo }`. Same normalization idea as
  `NpmRegistryLookup.extractGitHubRepo` (see
  [`docs/data-sources.md`](./data-sources.md)), just for a git remote URL's
  shapes (`git+https://`, `git@github.com:`, `ssh://git@github.com/`)
  instead of npm's `repository` field. Returns `null` for a non-GitHub
  remote - there's nothing to open a PR against.

**Authenticating the push**: `git`'s own push credentials aren't assumed to
be configured for whatever repo `--path`/`--repo` points at - `push()` sets
`http.extraHeader` to `Authorization: Basic <base64(x-access-token:token)>`,
the same `github.token` `PullRequestService` uses, and the same header
format GitHub documents for using a PAT over HTTPS git (works for both
classic and fine-grained tokens). Set via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/
`GIT_CONFIG_VALUE_0` env vars rather than `git -c ...` on the command
line - `-c` puts the token in argv, which (unlike env vars) is visible to
any other process on the machine via `ps`. A no-op if `origin` is an SSH
remote (`git@github.com:...`) - git only applies `http.extraHeader` to
HTTP(S) transport, so this doesn't break SSH-authenticated pushes, it just
doesn't help them either. This logic lives in `git-auth.ts`'s
`gitAuthEnv(token)`, shared with `CloneTool` (above) rather than
duplicated - `push()` and `clone()`/`pull()` need the exact same header.

## `PullRequestService.open(owner, repo, params)`

`POST https://api.github.com/repos/<owner>/<repo>/pulls` with
`{ title, head, base, body }`, authenticated via `github.token` (see
[`docs/config.md`](./config.md)) as `Authorization: Bearer <token>`. Returns
the created PR's `html_url`.

## `GithubModule.openPullRequestForCodemod(request)`

`request.packages` is one or more packages - more than one only for a
scope-siblings group (see [`docs/suggestions.md`](./suggestions.md) §
Grouping scoped packages), everything below still produces exactly **one**
PR either way:

1. `GitTool.resetToDefaultBranch(request.repoPath)` - see § Resetting
   before every pull, and before every PR attempt above. Runs first,
   before anything else touches the working tree.
2. `DependencyBumper.bumpAll(request.repoPath, request.packages)`.
3. `CodemodApplier.apply(request.codemodPath, request.repoPath)`.
4. `GitTool.hasChanges(request.repoPath)` — if false, returns
   `{ created: false, reason: "codemod produced no changes" }` without
   touching git at all. Not a failure: a codemod's real call sites might
   only use API surface that didn't actually change (verified in practice -
   running the chalk v4→v5 codemod against a real dependent produced zero
   edits, because that repo only used style methods chalk v5 left alone).
5. `GitTool.remoteRepo(...)` — if `origin` isn't a GitHub remote, returns
   `{ created: false, reason: "origin remote isn't a GitHub repo" }`.
6. Branches as `apiweiser-cli/<label>-<newVersion>` (sanitized) and commits
   with `Migrate <label> from <version> to <newVersion>` - for a single
   package `<label>` is its name; for a group it's the shared scope (e.g.
   `@angular`), since multi-package groups are always scope-siblings by
   construction. Pushes, then opens the PR - title is the same message,
   body lists every package's `version -> newVersion` plus the combined
   changelog summary and a pointer to the codemod package's local path (see
   [`docs/change-requests.md`](./change-requests.md) § `CodemodRegistry`).

Returns `{ created: true, url }` on success - and, in that same case,
records the PR via `PullRequestsRepository.insert()` (see
[`docs/database.md`](./database.md) § `pull_requests`), once per package in
the group, all pointing at the same `url` - `pull_requests` stays one row
per `(PR, package)`, not one row per PR, so a query for any single package
in a group still finds it.

## Who calls this

`ChangeRequestsModule.create()` (see
[`docs/change-requests.md`](./change-requests.md)), only after
`CodingAgentService.generateCodemod()` reports `success: true` - a failed
codemod attempt never reaches this module at all. Wrapped in try/catch;
logs and moves on rather than crashing `SuggestionsModule.generate()`, same
resilience pattern as everywhere else in this CLI.

## Config

Needs `github.token` filled in - a PAT with repo/PR write access on
whatever repo `--path` points at (see [`docs/config.md`](./config.md)).
`SuggestionsModule`'s constructor takes it directly, alongside
`codingAgent`.
