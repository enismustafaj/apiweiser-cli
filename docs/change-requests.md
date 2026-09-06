# Change requests

`src/change-requests/` — turns a breaking package update (surfaced by
[`docs/suggestions.md`](./suggestions.md), which classified it via
[`docs/data-sources.md`](./data-sources.md) § Release analysis) into a
generated, tested, and applied codemod.

```
src/change-requests/
  types.ts       CodemodIdentity, CodemodAgent, ChangeRequestInput/Result, ...
  index.ts       class ChangeRequestsModule - resolve -> apply -> verify
  local-agent.ts class LocalCodemodAgent - spawns the user's configured coding agent CLI
  generator.ts   class CodemodGenerator - reuses a registered codemod, or asks the agent for one
  registry.ts    class CodemodRegistry - on-disk store of generated codemods, keyed by identity
  applier.ts     class CodemodApplier - runs a stored codemod package against a repo
  verifier.ts    class RepositoryVerifier - runs the caller's verification commands
  paths.ts       repositoryRelativePath - rejects paths escaping the repo
  process.ts     runProcess - spawns a command, capturing stdout/stderr/exit code
```

This module doesn't define its own codemod package format - it delegates
authoring, validation, testing, and execution to
[Codemod AI](https://codemod.com/blog/npx-codemod-ai) (the `codemod` npm
package), and only owns the orchestration: deciding _when_ to generate one,
storing it for reuse, and wiring it into this repo's suggestions/verification
flow.

## `ChangeRequestInput`

| field                  | type                     | notes                                        |
| ---------------------- | ------------------------ | -------------------------------------------- |
| `repoPath`             | `string`                 | repo the codemod will be applied to          |
| `datasource`           | `string`                 | e.g. `npm`, matches Renovate's datasource    |
| `packageName`          | `string`                 |                                              |
| `fromVersion`          | `string`                 | current version, before the update           |
| `toVersion`            | `string`                 | Renovate's proposed version                  |
| `packageFile`          | `string`                 | e.g. `package.json`                          |
| `changelog`            | `string`                 | from `release_analysis_results.summary`      |
| `callSites`            | `CallSite[]`             | from `CallSitesRepository.findForDependency` |
| `verificationCommands` | `VerificationCommand[]?` | e.g. `[{ command: "npm", args: ["test"] }]`  |

## `ChangeRequestsModule.create(input)`

Called by `SuggestionsModule` (see [`docs/suggestions.md`](./suggestions.md)
§ Raising change requests) whenever a proposed update's new version was
already classified as breaking.

1. **Resolve** a codemod for this exact `(datasource, packageName, fromVersion, toVersion)`
   - `CodemodRegistry.find` first - reuse it if one was already generated and stored.
   - Otherwise ask the configured `CodemodAgent` to build one into a scratch
     directory, confirm it's real (not a starter scaffold) via
     `codemod ai call validate_codemod_package`, run its own `npm test`, and
     store it in the registry.
2. **Apply** the resolved codemod against `repoPath`, via `codemod workflow run`.
3. **Verify** by running `verificationCommands` (e.g. `npm test`) against the
   now-modified repo.

Throws on any step's failure (a package that never gets past scaffold state,
a failing test, a non-zero verification command) - the caller
(`SuggestionsModule`) wraps this in try/catch and logs, same resilience
pattern as everywhere else.

## `CodemodAgent` and `LocalCodemodAgent`

`ChangeRequestsModule` doesn't call any specific AI SDK - it delegates
codemod generation to a `CodemodAgent`:

```ts
interface CodemodAgent {
  generate(input: CodemodGenerationInput, outputDirectory: string): Promise<void>;
}
```

`LocalCodemodAgent` is the built-in implementation: it spawns whichever
coding agent CLI the user has configured (Codex, Claude Code, Cursor, ...)
with `cwd` set to a fresh scratch directory, and asks it to build a codemod
package there - without dictating what files that package contains.

```json
{
  "codemodAgent": {
    "command": "npx",
    "args": ["--yes", "@anthropic-ai/claude-code", "-p", "--dangerously-skip-permissions"]
  }
}
```

The generated prompt is appended as the final argument (e.g.
`codex exec <prompt>`, `claude -p <prompt>`). There's no built-in default
agent - `ChangeRequestsModule` throws if constructed without one, and
`SuggestionsModule` simply skips raising change requests until
`codemodAgent` is configured (see [`docs/config.md`](./config.md)). A
non-interactive permission-bypass flag (`--dangerously-skip-permissions` for
Claude Code, or the equivalent for your agent) is required - there's no TTY
to approve prompts when this runs on a cron schedule.

**Before every generation, `LocalCodemodAgent` runs
`npx codemod ai --harness <agent> --no-interactive --user`** to install (or
confirm) Codemod AI's persistent skill for the configured agent - this isn't
optional or a one-time setup step the user has to remember. The harness name
is guessed from the configured `command`/`args` (`claude`, `codex`, `cursor`,
...), falling back to `auto` (Codemod AI's own detection). This install is
idempotent and cheap (a few seconds) when already installed, so paying that
cost on every call is simpler than tracking install state ourselves.

The prompt (`generationPrompt` in `local-agent.ts`) tells the agent to use
that skill (or any other codemod-authoring tool it has - AST/tree-sitter
inspection, its own `/codemod` workflow) to scaffold, implement, test, and
validate the package - it does **not** specify file names or a package
schema. Codemod AI's own tooling owns that format entirely: a real run
produces a full `codemod.yaml` / `workflow.yaml` / `scripts/` / `tests/`
package (via `codemod init` under the hood), not anything this repo defines.

## `CodemodRegistry`

Stores generated codemod packages under `~/.apiweiser-cli/codemods/<id>/`,
where `id` is a hash of `(datasource, packageName, fromVersion, toVersion)`
(`codemodId`). `find`/`store` never read identity back out of a file the
agent wrote - the caller always already has the identity it's looking up or
storing, so the returned `CodemodPackage.manifest` is synthesized from that
identity plus the caller's `changelog` (as `summary`), not parsed off disk.
`store` copies a validated scratch directory into the registry, atomically
(rename into place), racing writers included - the real, expected case for
this registry, since many repos can hit the same breaking update around the
same time.

## `CodemodApplier`

Runs `npx codemod workflow run --workflow <registry-directory> --target
<repoPath> --no-interactive --allow-fs --allow-child-process` - the Codemod
AI CLI's own way to execute a local (unpublished) package against a target
repo, with `cwd` set to `repoPath`. No custom stdin protocol, no assumption
about what the package's entrypoint is called.
