# apiweiser-scanner

Scans a repo's dependencies (via SBOM), finds where each one is actually
called in the source (via ts-morph), tracks version updates Renovate
proposes, and — for dependencies it's never seen before — derives where to
fetch their release changelog from (npm registry metadata, no LLM
involved). Everything is persisted to a local sqlite db.

## Requirements

- Node.js 22+ (uses `node:sqlite` and runs `.ts` files directly — no
  build step, no ts-node)

## Setup

```sh
npm install
```

No config file needed — nothing in the CLI calls out to an LLM.

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

All state lives in `~/.apiweiser-scanner/` — the sqlite db and
SBOM/Renovate report caches — separate from whatever repo you point
`--path` at.

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
  lookup queue + scheduler, and why only brand-new dependencies get queued
- [`docs/suggestions.md`](docs/suggestions.md) — the Renovate-backed
  version-suggestion module and its cron scheduler
- [`docs/config.md`](docs/config.md) — the CLI's config file (currently
  unused, kept in case a future feature needs an LLM again)
