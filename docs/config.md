# Config

> **Currently unused.** This was built to hold LLM credentials for
> `ChangelogSourceAgent`, which has since been removed —
> `DataSourcesModule` derives changelog sources from npm registry metadata
> now, no LLM involved (see [`docs/data-sources.md`](./data-sources.md)).
> Nothing constructs `main.ts`'s CLI with a config anymore. Left in place
> rather than deleted, in case a future feature needs an LLM again; ask if
> you want it removed instead.

`src/config/` — the CLI's own config file, which the user has to fill in
themselves (an LLM API key, at minimum) before `--path` will run.

```
src/config/
  config.ts         LlmConfig, AppConfig
  config-loader.ts  class ConfigLoader
```

## File location

`~/.apiweiser-scanner/config.json` — same dedicated directory as the
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
  }
}
```

`url` is passed straight through as the OpenAI SDK's `baseURL` — pointing
it at a self-hosted or proxy endpoint that speaks the same wire format
works, not just `api.openai.com` directly.

## `ConfigLoader.load(configPath?)`

Not currently called anywhere (see the note above). When it was wired up,
called once at the top of `main.ts` before anything else ran, so a missing
or incomplete config failed fast, before any scanning work started.

- **File missing**: writes the template above (with an empty `apiKey`) to
  `configPath`, then throws, telling the user where to fill it in. The next
  run either succeeds (if they filled it in) or hits the next case.
- **File present but missing `llm.apiKey`, `llm.url`, or `llm.model`**:
  throws naming which field(s) are missing.
- **File present and valid**: returns the parsed `AppConfig`.

`configPath` defaults to the real location above; tests pass an explicit
temp path instead so they don't touch the user's actual config.
