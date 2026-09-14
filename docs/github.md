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

**Trust model, same as everywhere else in this CLI**: `ConfigLoader` only
checks that `github.token` is _present_, never that it's actually a valid
credential (same for `llm.apiKey`) - so a garbage or expired token breaks
`clone()` even against a fully public repo, the same way it would already
break `push()`/PR creation today. No fallback to an unauthenticated clone
attempt; a token the user configured is trusted to be real.

## `DependencyBumper.bump(repoPath, packageName, newVersion)`

Found missing the hard way: applying the chalk v4→v5 codemod to a real
dependent produced a PR that migrated call-site syntax to v5's API but
still declared `chalk: "^4.1.0"` in `package.json` - the installed v4
doesn't have the named exports the migrated code now imports, so the PR
didn't even compile. `CodemodApplier`'s transform only touches source
files (an AST-based tool has no business editing package manifests or
running installs), so this is a separate, deterministic step:

1. Skips entirely if `packageName` isn't declared in `dependencies` or
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

Not covered by an automated test beyond the "not a direct dependency, stay
a no-op" guard - the actual install is network-bound, same reasoning as
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

1. `DependencyBumper.bump(request.repoPath, request.packageName, request.newVersion)`.
2. `CodemodApplier.apply(request.codemodPath, request.repoPath)`.
3. `GitTool.hasChanges(request.repoPath)` — if false, returns
   `{ created: false, reason: "codemod produced no changes" }` without
   touching git at all. Not a failure: a codemod's real call sites might
   only use API surface that didn't actually change (verified in practice -
   running the chalk v4→v5 codemod against a real dependent produced zero
   edits, because that repo only used style methods chalk v5 left alone).
4. `GitTool.remoteRepo(...)` — if `origin` isn't a GitHub remote, returns
   `{ created: false, reason: "origin remote isn't a GitHub repo" }`.
5. Branches as `apiweiser-cli/<packageName>-<newVersion>` (sanitized),
   commits everything with `Migrate <packageName> <version> -> <newVersion>`,
   pushes it, then opens the PR - title is the same migration summary, body
   is the changelog summary plus a pointer to the codemod package's local
   path (see [`docs/change-requests.md`](./change-requests.md) §
   `CodemodRegistry`).

Returns `{ created: true, url }` on success - and, in that same case,
records the PR via `PullRequestsRepository.insert()` (see
[`docs/database.md`](./database.md) § `pull_requests`) before returning, so
every opened PR is queryable afterward without scraping GitHub itself.

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
