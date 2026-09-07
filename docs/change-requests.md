# Change requests

`src/change-requests/` — turns a breaking package update (surfaced by
[`docs/suggestions.md`](./suggestions.md), which classified it via
[`docs/data-sources.md`](./data-sources.md) § Release analysis) into a
codemod: asks a configured coding agent to build and validate one, "the
codemod way" (see below), keeps the result in a local registry either way,
and on success hands it to [`docs/github.md`](./github.md) to actually
apply it and open a PR.

```
src/change-requests/
  types.ts                          ChangeRequestInput, CodemodResult
  registry/codemod-registry.ts      class CodemodRegistry
  agent/coding-agent-service.ts     class CodingAgentService(config)
  index.ts                          class ChangeRequestsModule(codingAgentConfig, githubConfig)
```

## `ChangeRequestInput`

| field         | type         | notes                                        |
| ------------- | ------------ | -------------------------------------------- |
| `repoPath`    | `string`     | the repo being monitored, for `GithubModule` |
| `packageName` | `string`     |                                              |
| `version`     | `string`     | current version, before the update           |
| `newVersion`  | `string`     | Renovate's proposed version                  |
| `callSites`   | `CallSite[]` | from `CallSitesRepository.findForDependency` |
| `isBreaking`  | `boolean`    | from `release_analysis_results.is_breaking`  |
| `summary`     | `string`     | from `release_analysis_results.summary`      |

## "The codemod way"

Rather than asking an LLM to describe or hand-write the fix once, this asks
a full coding agent session to build a reusable, tested
**[codemod](https://codemod.com) package** - a deterministic, AST-based
transform - and iterate on it until its own tests pass. The agent isn't
prompted from scratch: `install.sh` (or a manual
`npx codemod ai --harness <claude|codex> --user --no-interactive`) installs
the [Codemod CLI](https://docs.codemod.com/cli)'s AI skill and MCP tools
**user-scoped** - not `--project`, since a globally-installed CLI has no
"project" of its own to scope it to, and (verified directly, from a
throwaway directory with no project config at all) a user-scoped install
resolves the `/codemod` command regardless of which directory the agent is
invoked from. That install is what teaches the agent to, on seeing a
`/codemod ...` prompt: scaffold a package with `codemod init`, implement
the transform with AST-selected edits (not regex/string replace), add
fixtures, and **loop against the package's own tests and
`validate_codemod_package` until both are green** - see
`~/.claude/commands/codemod.md` for the exact rules it follows. That loop
happens entirely inside the agent's own session; this module does not
implement it.

## `CodemodRegistry`

Local registry of generated codemod packages, one directory per
`(packageName, fromVersion, toVersion)` triple, under
`~/.apiweiser-cli/codemods/<packageName>/<fromVersion>_to_<toVersion>/`. A
registry "entry" is just that directory - `codemod init` scaffolds directly
into it, no separate copy/import step.

```ts
pathFor(packageName, fromVersion, toVersion): string // creates it if missing
has(packageName, fromVersion, toVersion): boolean    // true once codemod.yaml exists there
```

## `CodingAgentService.generateCodemod(input)`

Same subprocess-and-wait shape as `SbomTool`/`RenovateTool`: spawns the
configured coding agent CLI once, with a prompt built from `input` (package
name, old/new version, changelog summary, and every call site to migrate),
and waits for it to exit. Which CLI, and the flags that put it into
non-interactive/headless mode, come from config (see
[`docs/config.md`](./config.md)) - e.g.:

`cwd` is `CodemodRegistry.pathFor(...)` directly - the agent scaffolds the
package in place. (This used to need a workaround: cwd'd at this project's
own root instead, back when the skill was installed `--project`-scoped,
since that only resolves from the specific directory it was installed
into. Installing it `--user`-scoped instead (see § "The codemod way" above)
resolves that regardless of cwd, so the workaround is gone.)

```json
{ "codingAgent": { "command": "claude", "args": ["-p"] } }
```

`args` are appended before the prompt, which is always the final argument
(`codex`'s headless mode would instead be `{ "command": "codex", "args":
["exec"] }`).

**Generalizing beyond the sample repo**: found the hard way, testing
against a second real repo - a codemod is built from one repo's call
sites, but `CodemodRegistry` stores it for reuse against _any_ repo. The
first chalk codemod (built from `vercel/pkg`, where every real call site
happened to `import chalk from 'chalk'`) only pattern-matched that one
default-import style - applying it to `TypeStrong/ts-loader`, which uses
`import * as chalk from 'chalk'`, made zero edits. Not a `Scanner` gap
(`Scanner` resolves call sites via the type checker, so it already found
every real call site in `ts-loader` regardless of import style) - the
codemod's own transform is `ast-grep` pattern matching, which is inherently
narrower, and the agent that wrote it only had evidence from one import
style to go on. The prompt now explicitly tells the agent to handle every
common way a package gets imported (default, namespace, named/destructured,
`require(...)`) rather than just whichever one the sampled call sites show.

**Reporting the result**: an agent session's output is a transcript, not
structured data. The prompt asks the agent to print exactly one line at the
end, starting with `CODEMOD_RESULT:`, followed by JSON matching
`{ success: boolean, codemodPath: string, reason?: string }`.
`CodingAgentService` looks for that line (from the end, in case the agent's
transcript happens to mention the marker elsewhere) and parses it; a
missing or unparseable line is treated as failure, logging the raw output
for debugging rather than guessing.

## `ChangeRequestsModule.create(input)`

Called by `SuggestionsModule` (see [`docs/suggestions.md`](./suggestions.md)
§ Raising change requests) whenever a proposed update's new version was
already classified as breaking.

1. `CodingAgentService.generateCodemod(input)`. If it didn't succeed, logs
   and returns - the codemod package directory still exists either way (see
   `CodemodRegistry`), just without a passing transform in it, for a human
   to pick up. `GithubModule` is never called for a failed attempt.
2. On success, `GithubModule.openPullRequestForCodemod(...)` (see
   [`docs/github.md`](./github.md)) - applies the codemod to `input.repoPath`
   for real and opens a PR, or logs why it didn't (no changes produced, or
   `origin` isn't a GitHub remote). Wrapped in try/catch; a PR-creation
   failure doesn't crash `SuggestionsModule.generate()`.
