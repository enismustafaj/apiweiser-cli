# Config

`src/config/` — the CLI's own config file, which the user has to fill in
themselves (an LLM API key, a coding agent command, a GitHub token) before
running the CLI at all — every invocation always starts the changelog-lookup
and suggestions schedulers (see below), so this is never optional.

## File location

`~/.apiweiser-cli/config.json` — same dedicated directory as the
sqlite db and the SBOM/Renovate caches (see
[`docs/database.md`](./database.md)). This is config for the CLI itself,
not for whatever repo it's pointed at with `--path`, so it doesn't live in
the scanned repo.

## Shape

Three required top-level keys: `llm` (`apiKey`, `url`, `model`),
`codingAgent` (`command`, `args`), and `github` (`token`) — see
`AppConfig`/`LlmConfig`/`CodingAgentConfig`/`GithubConfig` in
`src/config/config.ts` for the exact fields. A fourth, `codemodRegistry`,
is optional in the file - see
[`docs/change-requests.md`](./change-requests.md) § Remote registry.
Omitting it means `{ "mode": "local" }` - every codemod is only ever built
and reused locally. `"remote"` requires `scope` and `apiKey` too.

In code, `AppConfig.codemodRegistry` is never missing: `ConfigLoader`
(below) fills in the local default, and the type is a discriminated union -
`{ mode: "local" } | { mode: "remote"; scope; apiKey }`. Checking
`mode === "remote"` is enough for TypeScript to know `scope` and `apiKey`
exist, so nothing downstream re-validates them; `RemoteCodemodRegistry`
only accepts the remote variant at all.

`llm.url` is passed straight through as the OpenAI SDK's `baseURL` —
pointing it at a self-hosted or proxy endpoint that speaks the same wire
format works (e.g. a Groq endpoint, verified during testing), not just
`api.openai.com` directly.

`codingAgent.command` is the coding agent CLI `CodingAgentService` spawns
(see [`docs/change-requests.md`](./change-requests.md)) — `"claude"` for
Claude Code, `"codex"` for Codex. `codingAgent.args` are whatever flags put
that CLI into non-interactive/headless mode (Claude Code's `-p`, Codex's
`exec`) — appended before the prompt, which is always the final argument.

`github.token` is a PAT with repo/PR write access on whatever repo `--path`
points at. Used twice, both by [`docs/github.md`](./github.md): as
`Authorization: Bearer <token>` when `PullRequestService` opens the PR, and
by `GitTool` to authenticate `git push` itself (via `http.extraHeader`) —
this CLI doesn't assume `git` already has separate push credentials
configured for that repo.

## `ConfigLoader.load(configPath?)`

Called unconditionally at the top of `main.ts` — every invocation needs it,
since the changelog-lookup and suggestions schedulers always start (see
[`docs/data-sources.md`](./data-sources.md)). A missing or incomplete
config fails fast, before anything else runs.

- **File missing**: writes the template above (with an empty `apiKey`) to
  `configPath`, then throws, telling the user where to fill it in. The next
  run either succeeds (if they filled it in) or hits the next case.
- **File present but missing `llm.apiKey`, `llm.url`, or `llm.model`**:
  throws naming which field(s) are missing.
- **File present but missing `codingAgent.command`**: throws naming that.
- **File present but missing `github.token`**: throws naming that.
- **File present with `codemodRegistry.mode: "remote"` but missing
  `codemodRegistry.scope` or `codemodRegistry.apiKey`**: throws naming
  that. Not checked at all when `codemodRegistry` is absent or
  `mode: "local"` - only `"remote"` has real requirements.
- **File present with any other `codemodRegistry.mode`**: throws - a typo
  like `"remtoe"` used to silently mean local and never publish.
- **File present and valid**: returns the `AppConfig`, with
  `codemodRegistry` set to `{ mode: "local" }` if it was absent. A local
  entry keeps only `mode` (stray `scope`/`apiKey` are dropped); a remote
  one keeps `mode`, `scope` and `apiKey`.

`configPath` defaults to the real location above; tests pass an explicit
temp path instead so they don't touch the user's actual config.

## Who uses it

- `main.ts` always builds the background jobs after a `scan` (see
  [`docs/jobs.md`](./jobs.md)), passing the whole config into
  `new SuggestionsModule(config)`, which forwards `llm`, `codingAgent`,
  `github`, and `codemodRegistry` to `SuggestionsModule` → `ChangeRequestsModule` →
  `ChangelogSummarizer`/`CodingAgentService`/`GithubModule` (see
  [`docs/data-sources.md`](./data-sources.md),
  [`docs/change-requests.md`](./change-requests.md), and
  [`docs/github.md`](./github.md)).

`DataSourcesModule`'s changelog-_source_ lookups (npm-registry-only) don't
need any of this config themselves - but since `main.ts` always runs
their job too, a valid config is still required just to launch the
process at all.
