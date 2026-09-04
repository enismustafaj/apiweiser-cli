# apiweiser-scanner

Scans a repo's dependencies (via SBOM), finds where each one is actually
called in the source (via ts-morph), tracks version updates Renovate
proposes, derives where to fetch each dependency's release changelog from
(npm registry metadata, no LLM involved), and — on a daily schedule —
classifies each package's latest release as breaking or not, via an LLM.
Everything is persisted to a local sqlite db.

## Requirements

- Node.js 22+ (uses `node:sqlite` and runs `.ts` files directly — no
  build step, no ts-node)

## Setup

```sh
npm install
```

No config file needed for scanning or changelog-source lookups. Only
`--release-analysis-cron` (see below) needs an LLM — the first time it's
used, it creates `~/.apiweiser-scanner/config.json` for you and exits with
an error asking you to fill it in:

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
self-hosted/proxy endpoint works too (an OpenAI-compatible Groq endpoint
was used during testing). See [`docs/config.md`](docs/config.md).

## Usage

```sh
node src/main.ts --path <path-to-repo>
```

Scans the target repo: generates its SBOM, upserts its dependencies,
re-scans call sites for anything new or version-changed, and queues
anything brand new for a changelog-source lookup. Safe to re-run —
unchanged dependencies are skipped entirely, and this doesn't make any
network calls beyond the SBOM/Renovate tooling itself, so it's fast (a
769-dependency repo scans in a few seconds).

```sh
node src/main.ts --path <path-to-repo> --suggestions-cron "<cron expression>"
```

Also starts a Renovate-backed scheduler that periodically checks for
version update suggestions. The process keeps running instead of exiting
after the scan.

```sh
node src/main.ts --data-sources-cron "<cron expression>"
```

Drains the changelog-source lookup queue (see above) in rate-limit-sized
batches, on its own schedule. Doesn't need `--path` — the queue is global,
not tied to any one repo.

```sh
node src/main.ts --release-analysis-cron "0 0 * * *"
```

Once a day (the intended cadence — the expression itself is up to you):
fetches every known package's latest GitHub release and classifies
whether it's a breaking change, via an LLM. Also doesn't need `--path`.
Needs a filled-in config (see Setup above).

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
  lookup queue, and the daily release-analysis/breaking-change classifier
- [`docs/suggestions.md`](docs/suggestions.md) — the Renovate-backed
  version-suggestion module and its cron scheduler
- [`docs/change-requests.md`](docs/change-requests.md) — scaffolding for
  turning a breaking update into a change request (not implemented yet)
- [`docs/config.md`](docs/config.md) — the CLI's config file (only needed
  for `--release-analysis-cron`)
