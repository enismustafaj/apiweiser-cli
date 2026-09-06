# Config

`src/config/` — the CLI's own config file, which the user has to fill in
themselves (an LLM API key, at minimum) before `--release-analysis-cron`
will run.

```
src/config/
  config.ts         LlmConfig, AppConfig
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
  "codemodAgent": {
    "command": "npx",
    "args": ["--yes", "@anthropic-ai/claude-code", "-p", "--dangerously-skip-permissions"]
  }
}
```

`url` is passed straight through as the OpenAI SDK's `baseURL` — pointing
it at a self-hosted or proxy endpoint that speaks the same wire format
works (e.g. a Groq endpoint, verified during testing), not just
`api.openai.com` directly.

`codemodAgent` is optional and unrelated to `llm` — it's the coding agent
CLI that `--suggestions-cron` spawns to write codemods for breaking updates
(see [`docs/change-requests.md`](./change-requests.md)). `command` is
whatever's on your `PATH` (`codex`, `claude`, `cursor-agent`, ...); `args`
are passed through as-is, with the generated prompt appended as the final
argument, plus whatever non-interactive/permission-bypass flag your agent
needs (there's no TTY to approve prompts on a cron schedule). Leaving
`codemodAgent` out just means breaking updates get recorded as suggestions
without a change request being raised. You don't need to separately install
Codemod AI's skill for the agent yourself - `LocalCodemodAgent` does that
automatically before every generation.

## `ConfigLoader.load(configPath?)`

Called once, at the top of `main.ts`, but only when `--release-analysis-cron`
is passed — `--path` and `--data-sources-cron` don't need an LLM at all,
so they don't load this. A missing or incomplete config fails fast, before
`ReleaseAnalysisScheduler` starts.

- **File missing**: writes the template above (with an empty `apiKey`) to
  `configPath`, then throws, telling the user where to fill it in. The next
  run either succeeds (if they filled it in) or hits the next case.
- **File present but missing `llm.apiKey`, `llm.url`, or `llm.model`**:
  throws naming which field(s) are missing.
- **File present and valid**: returns the parsed `AppConfig`.

`configPath` defaults to the real location above; tests pass an explicit
temp path instead so they don't touch the user's actual config.

## `ConfigLoader.loadCodemodAgentConfig(configPath?)`

Unlike `load()`, this never creates a template or throws — raising change
requests is opt-in, so plain suggestion scanning shouldn't require any
config to exist. Returns `undefined` if the config file doesn't exist, or
if it exists but has no `codemodAgent` section; otherwise returns it as-is
(no field validation - `LocalCodemodAgent` just tries to spawn `command`).

## Who uses it

`main.ts`'s `--release-analysis-cron` handler loads it and passes
`config.llm` into `new ReleaseAnalysisScheduler(cronExpression, config.llm)`,
which forwards it to `ReleaseAnalysisModule`, which constructs
`BreakingChangeClassifierAgent` from it (see
[`docs/data-sources.md`](./data-sources.md) § Release analysis). This is
the only thing in the CLI that needs an LLM — `DataSourcesModule`'s
changelog-_source_ lookups are npm-registry-only, no LLM involved.

`main.ts`'s `--suggestions-cron` handler calls `loadCodemodAgentConfig()`
and, if it returns something, constructs a `ChangeRequestsModule` around a
`LocalCodemodAgent` and passes it to the `Scheduler` (see
[`docs/change-requests.md`](./change-requests.md) and
[`docs/suggestions.md`](./suggestions.md)).
