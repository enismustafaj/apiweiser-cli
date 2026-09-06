# Config

`src/config/` — the CLI's own config file, which the user has to fill in
themselves (an LLM API key, a coding agent command, a GitHub token, at
minimum) before `--release-analysis-cron` or `--suggestions-cron` will run.

```
src/config/
  config.ts         LlmConfig, CodingAgentConfig, GithubConfig, AppConfig
  config-loader.ts  class ConfigLoader
```

## File location

`~/.apiweiser-cli/config.json` — same dedicated directory as the
sqlite db and the SBOM/Renovate caches (see
[`docs/database.md`](./database.md)). This is config for the CLI itself,
not for whatever repo it's pointed at with `--path`, so it doesn't live in
the scanned repo.

## Shape

```json
{
  "llm": {
    "apiKey": "sk-...",
    "url": "https://api.openai.com/v1",
    "model": "gpt-5"
  },
  "codingAgent": {
    "command": "claude",
    "args": ["-p"]
  },
  "github": {
    "token": "ghp_..."
  }
}
```

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

Called at the top of `main.ts`, but only when `--release-analysis-cron` or
`--suggestions-cron` is passed — `--path` alone and `--data-sources-cron`
don't need any of this, so they don't load it. A missing or incomplete
config fails fast, before either scheduler starts.

- **File missing**: writes the template above (with an empty `apiKey`) to
  `configPath`, then throws, telling the user where to fill it in. The next
  run either succeeds (if they filled it in) or hits the next case.
- **File present but missing `llm.apiKey`, `llm.url`, or `llm.model`**:
  throws naming which field(s) are missing.
- **File present but missing `codingAgent.command`**: throws naming that.
- **File present but missing `github.token`**: throws naming that.
- **File present and valid**: returns the parsed `AppConfig`.

`configPath` defaults to the real location above; tests pass an explicit
temp path instead so they don't touch the user's actual config.

## Who uses it

- `main.ts`'s `--release-analysis-cron` handler loads it and passes
  `config.llm` into `new ReleaseAnalysisScheduler(cronExpression, config.llm)`,
  which forwards it to `ReleaseAnalysisModule`, which constructs
  `BreakingChangeClassifierAgent` from it (see
  [`docs/data-sources.md`](./data-sources.md) § Release analysis).
- `main.ts`'s `--suggestions-cron` handler loads it and passes
  `config.codingAgent`/`config.github` into
  `new SuggestionsScheduler(repoPath, cronExpression, config.codingAgent, config.github)`,
  which forwards them to `SuggestionsModule` → `ChangeRequestsModule` →
  `CodingAgentService`/`GithubModule` (see
  [`docs/change-requests.md`](./change-requests.md) and
  [`docs/github.md`](./github.md)).

`DataSourcesModule`'s changelog-_source_ lookups (npm-registry-only) are
the one thing in this CLI that needs none of this.
