# apiweiser-scanner

Scans a repo's dependencies (via SBOM), finds where each one is actually
called in the source (via ts-morph), tracks version updates Renovate
proposes, and — for dependencies it's never seen before — asks an LLM
where to fetch their release changelog from. Everything is persisted to a
local sqlite db.

## Requirements

- Node.js 22+ (uses `node:sqlite` and runs `.ts` files directly — no
  build step, no ts-node)

## Setup

```sh
npm install
```

The first run creates `~/.apiweiser-scanner/config.json` for you and exits
with an error asking you to fill it in:

```json
{
  "llm": {
    "apiKey": "sk-...",
    "url": "https://api.openai.com/v1",
    "model": "gpt-5"
  }
}
```

`url` is passed straight through as the OpenAI SDK's `baseURL`, so a
self-hosted/proxy endpoint works too. See [`docs/config.md`](docs/config.md).

## Usage

```sh
node src/main.ts --path <path-to-repo>
```

Scans the target repo: generates its SBOM, upserts its dependencies,
re-scans call sites for anything new or version-changed, and looks up a
changelog source for anything brand new. Safe to re-run — unchanged
dependencies are skipped entirely.

```sh
node src/main.ts --path <path-to-repo> --suggestions-cron "<cron expression>"
```

Also starts a Renovate-backed scheduler that periodically checks for
version update suggestions. The process keeps running instead of exiting
after the scan.

All state lives in `~/.apiweiser-scanner/` — the sqlite db, the config
file, and SBOM/Renovate report caches — separate from whatever repo you
point `--path` at.

## Development

```sh
npm test           # node's built-in test runner
npm run format      # prettier --write
npm run format:check
```

## How it works

Each module has its own doc:

- [`docs/scanner.md`](docs/scanner.md) — how `Scanner` resolves call sites
  via ts-morph's type checker (not import-tracing)
- [`docs/database.md`](docs/database.md) — schema, the shared sqlite
  singleton, FK enforcement
- [`docs/data-sources.md`](docs/data-sources.md) — the changelog-source
  agent, and why only brand-new dependencies trigger it
- [`docs/suggestions.md`](docs/suggestions.md) — the Renovate-backed
  version-suggestion module and its cron scheduler
- [`docs/config.md`](docs/config.md) — the CLI's own config file
