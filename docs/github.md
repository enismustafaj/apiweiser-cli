# GitHub

`src/github/` — turns a successfully-generated, already-tested codemod
package (see [`docs/change-requests.md`](./change-requests.md)) into an
actual PR against the repo being monitored: apply it for real, and - only
if it actually changed something - branch, commit, push, and open a PR
describing the migration.

```
src/github/
  types.ts                       PullRequestRequest, PullRequestResult, GitHubRemote
  tool/dependency-bumper.ts       class DependencyBumper
  tool/codemod-applier.ts        class CodemodApplier
  tool/git-tool.ts               class GitTool
  pull-request-service.ts        class PullRequestService(config)
  index.ts                       class GithubModule(config)
```

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
be configured for whatever repo `--path` points at - `push()` sets
`http.extraHeader` to `Authorization: Basic <base64(x-access-token:token)>`,
the same `github.token` `PullRequestService` uses, and the same header
format GitHub documents for using a PAT over HTTPS git (works for both
classic and fine-grained tokens). Set via `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/
`GIT_CONFIG_VALUE_0` env vars rather than `git -c ...` on the command
line - `-c` puts the token in argv, which (unlike env vars) is visible to
any other process on the machine via `ps`. A no-op if `origin` is an SSH
remote (`git@github.com:...`) - git only applies `http.extraHeader` to
HTTP(S) transport, so this doesn't break SSH-authenticated pushes, it just
doesn't help them either.

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

Returns `{ created: true, url }` on success.

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
