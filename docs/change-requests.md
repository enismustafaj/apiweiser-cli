# Change requests

`src/change-requests/` — turns a proposed package update (surfaced by
[`docs/suggestions.md`](./suggestions.md), summarized via
[`docs/data-sources.md`](./data-sources.md) § Changelog summarization)
into a codemod: asks a configured coding agent to build and validate one,
"the codemod way" (see below), keeps the result in a local registry either
way, and on success hands it to [`docs/github.md`](./github.md) to actually
apply it and open a PR.

## `ChangeRequestInput`

| field             | type                     | notes                                                                                 |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `repoPath`        | `string`                 | the repo being monitored, for `GithubModule`                                          |
| `packages`        | `ChangeRequestPackage[]` | usually one; more than one only for a scope-siblings group, see below                 |
| `callSites`       | `CallSite[]`             | combined across every package, always `[]` for a devDependency group (see below)      |
| `isDevDependency` | `boolean`                | from Renovate's `depType`, true only if every package in the group is a devDependency |
| `summary`         | `string`                 | from `ChangelogSummarizer.summarize`, combined across every package                   |

`ChangeRequestPackage` is `{ name, version, newVersion }`. Almost always a
single-element `packages` array - more than one only when
`SuggestionsModule.groupByScope` grouped several scope-siblings together
because they must be bumped in the same install call (see
[`docs/suggestions.md`](./suggestions.md) § Grouping scoped packages, and
`DependencyBumper.bumpAll` in [`docs/github.md`](./github.md) for the real
`ERESOLVE` this exists to avoid). Everything downstream - the codemod
registry key, the coding agent prompt, the PR - treats a one-package
`packages` array and a many-package one the same way, just with different
wording where a human would notice the difference.

**Why `isDevDependency` matters here**: `DependenciesModule.scan()` never
scans devDependencies for call sites at all (see
[`docs/scanner.md`](./scanner.md) § devDependencies aren't scanned at
all) - so `callSites` being empty means two different things depending on
this flag. For a real dependency, empty means "nothing in this repo
actually calls it" - skip, there's nothing to migrate. For a
devDependency, empty is the _normal_, expected case - the agent still gets
invoked, working from the changelog summary alone (see `CodingAgentService`
below).

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
`(packageName, fromVersion, toVersion)` under
`~/.apiweiser-cli/codemods/<packageName>/<key>/`. A registry "entry" is
just that directory - `codemod init` scaffolds directly into it, no
separate copy/import step. `pathFor(packageName, fromVersion, toVersion)`
returns that directory's path, creating it first if it's missing.

**The key depends on whether the upgrade crosses a major-version boundary**:

- **Crosses a major** (e.g. `4.1.0` → `5.0.0`): keyed by **major version
  only** - `<packageName>/4_to_5/`. Measured directly: reusing/extending an
  existing entry costs ~69% less than a from-scratch build (35 turns/$0.79
  vs 86 turns/$2.52, same real node-fetch v2→v3 migration) - but real repos
  rarely pin the exact same patch version, so keying by full version made
  that cheap path rare in practice: a repo on `chalk@4.1.0` and one on
  `chalk@4.1.2`, both migrating to `5.x`, used to get two separate entries,
  both built from scratch. Coarsening doesn't risk applying a wrong or
  incomplete transform across differing patch versions - that risk is
  already handled below.
- **Stays within the same major** (e.g. `2.4.5` → `2.7.0`): keyed by the
  **full, exact version pair** - `<packageName>/2.4.5_to_2.7.0/`. There's
  no equivalent stable "recipe" to generalize here. A major bump is
  documented by the package itself as one coherent breaking change
  regardless of which patch you're coming from; a same-major update isn't
  (a package can ship a breaking change without a major bump, per semver
  convention or not - see `ChangelogSummarizerAgent` in
  [`docs/data-sources.md`](./data-sources.md) § Changelog summarization).
  Two different same-major updates could be entirely unrelated fixes -
  coarsening those together would point the agent at a prior entry that
  has nothing to do with the current one, not just an incomplete one.

**For a multi-package group**, `CodingAgentService.registryKey` computes
`packageName` as the shared scope (`@angular`, not a joined list of every
member's name - groups are always scope-siblings, see
[`docs/suggestions.md`](./suggestions.md) § Grouping scoped packages) and
`fromVersion`/`toVersion` as the widest span across the group's members
(the lowest current version, the highest new version) - a reasonable
stand-in for "this exact upgrade" when members don't all move by the exact
same amount (e.g. `@angular/core` `5→20` alongside `@angular/router`
`5→22`).

Whether an entry that already exists is actually reusable as-is isn't a
question this class answers - there's no `has()`. That decision is left to
the agent itself (see `CodingAgentService.buildPrompt` below): a pure
existence check can't tell whether a codemod already sitting there covers
the current repo's call sites, only whether _some_ codemod was built for
this key before. Proven for real: a node-fetch codemod
built from one repo's call sites (which never used `.buffer()`) correctly
got extended - not blindly reused - when a second repo's call sites
included `response.buffer()`, a real v2 API the first repo never
exercised.

## `CodingAgentService.generateCodemod(input)`

Same subprocess-and-wait shape as `SbomTool`/`RenovateTool`: spawns the
configured coding agent CLI once, with a prompt built from `input` (package
name, old/new version, changelog summary, and every call site to migrate),
and waits for it to exit. Which CLI, and the flags that put it into
non-interactive/headless mode, come from config (see
[`docs/config.md`](./config.md)) - e.g. `codingAgent.command: "claude"`
with `codingAgent.args: ["-p"]` (Codex's headless mode would instead be
`command: "codex"`, `args: ["exec"]`). `args` are appended before the
prompt, which is always the final argument.

`cwd` is `CodemodRegistry.pathFor(...)` directly - the agent scaffolds the
package in place. (This used to need a workaround: cwd'd at this project's
own root instead, back when the skill was installed `--project`-scoped,
since that only resolves from the specific directory it was installed
into. Installing it `--user`-scoped instead (see § "The codemod way" above)
resolves that regardless of cwd, so the workaround is gone.)

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

**Capping the call-site list (token cost)**: `buildPrompt` includes at most
`MAX_CALL_SITES_PER_SURFACE` (3) examples per distinct `apiSurface`, not
every call site `Scanner` found. A repo with hundreds of call sites for one
dependency would otherwise turn the prompt itself into a large chunk of
input tokens, on every invocation, reused or not - and buys nothing, since
the transform is meant to generalize beyond the sample anyway (see above).
When the sample is smaller than the full list, the prompt says exactly how
much was cut and tells the agent to inspect the surrounding files itself
for the rest; below the cap, nothing changes.

**Always asks the agent, even if an entry already exists**: `cwd` may
already be non-empty (a previous repo hit this exact upgrade). The prompt
tells the agent to check for that and inspect what's there against the
current call sites - reuse it as-is if it already covers them, extend it
if it doesn't, only scaffold from scratch if nothing exists yet. This is
deliberately not a pre-check in `ChangeRequestsModule` (a plain
`existsSync` can't tell "some codemod exists" from "a codemod that
actually covers these call sites exists" - the exact gap the previous
paragraph's chalk/`ts-loader` case exposed) - always invoking the agent
costs more per repo, but a codemod that's silently wrong is worse than one
that takes longer to confirm right.

**Regression-safe extension**: fixtures accumulate in the same codemod
package's `tests/` directory across every repo that's ever hit this
upgrade - a first repo's fixtures aren't removed or replaced when a second
repo forces an extension, they just sit alongside the new ones (verified
in practice: the node-fetch codemod's original fixtures from one repo are
still present, untouched, next to the `.buffer()` fixtures a second repo
added hours later). The prompt requires the agent to run the codemod's
_entire_ test suite - old fixtures and new together, via
`run_jssg_tests`/`validate_codemod_package` - before reporting success, not
a filtered run scoped to just the current repo's call sites. That's what
actually proves a previous repo isn't regressed: not a check that its
fixture file still exists on disk, but that it still passes.

**devDependencies get a different prompt section, not a shorter one**:
`buildPrompt` branches on `input.isDevDependency` - a real dependency gets
the call-site sample described above; a devDependency gets a section
telling the agent there's no call-site sample (dev tooling isn't scanned,
see [`docs/scanner.md`](./scanner.md) § devDependencies aren't scanned at
all), to inspect the repo itself (config files, `package.json` scripts, CI
config), and that reporting success with no transform at all is a valid
outcome if nothing in this repo actually needs to change for the upgrade.
Both branches still ask for the same `CODEMOD_RESULT:` line and the same
full-test-suite discipline below - only the "what to base the transform
on" input differs.

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
§ Raising change requests) for every proposed update with a summarized
changelog - there's no breaking/not-breaking gate anymore.

0. If `input.callSites` is empty **and `input.isDevDependency` is false**,
   returns immediately - `{ success: true, codemodPath: "" }` - without
   spawning the coding agent or opening a PR at all. `SuggestionsModule`
   already checks this before calling in (see
   [`docs/suggestions.md`](./suggestions.md)); this is defense in depth for
   any other caller, not the primary guard - there's nothing for a codemod
   to migrate, and a full agent session just to confirm that costs real
   time and money for a foregone conclusion. A devDependency with no call
   sites is the normal case (see [`docs/scanner.md`](./scanner.md) §
   devDependencies aren't scanned at all), so this check doesn't apply to
   it - it still reaches step 1.
1. Otherwise, `CodingAgentService.generateCodemod(input)` - always, whether
   or not a
   codemod already exists for this package + version pair (see
   `CodemodRegistry`/§ "The codemod way" above for why that's the agent's
   call to make, not a pre-check here). If it didn't succeed, logs and
   returns - the codemod package directory still exists either way, just
   without a passing transform in it, for a human to pick up. `GithubModule`
   is never called for a failed attempt.
2. On success, `GithubModule.openPullRequestForCodemod(...)` (see
   [`docs/github.md`](./github.md)) - applies the codemod to
   `input.repoPath` for real and opens a PR, or logs why it didn't (no
   changes produced, or `origin` isn't a GitHub remote). Wrapped in
   try/catch; a PR-creation failure doesn't crash
   `SuggestionsModule.generate()`.
