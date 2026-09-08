# apiweiser-cli

A tool that watches a repo's dependencies for you: it finds where each one
is actually used in your code, tracks version updates as they're proposed,
figures out whether a given update is breaking, and — when it is — has a
coding agent write, test, and open a PR for the migration automatically.

## What it does

1. **Scan** (`--path`) — reads your repo's SBOM, records every dependency,
   and finds every place in your source each one is actually called.
2. **Look up changelogs** (daily) — for any dependency it's never seen
   before, figures out where its GitHub releases live.
3. **Classify releases** (daily) — fetches each dependency's latest GitHub
   release and asks an LLM whether it's a breaking change.
4. **Track suggestions** (daily) — runs Renovate to see what version
   updates are available for your repo.
5. **Raise change requests** (automatic, once 3 and 4 agree an update is
   breaking) — asks a coding agent to build and test a codemod for the
   migration, applies it to your repo, and opens a PR.

Steps 2-4 each run once a day, in that order, for as long as the process
keeps running.

Everything is persisted to a local sqlite database, separate from any repo
you point it at.

## Prerequisites

- **Node.js 22+** — runs `.ts` files directly, no build step
- **git**, on `PATH`
- **A coding agent CLI, already installed and logged in** — [Claude
  Code](https://docs.claude.com/en/docs/claude-code) or
  [Codex](https://github.com/openai/codex). This tool shells out to it; it
  doesn't set up an account for you.
- **A GitHub personal access token** with **Contents** and **Pull
  requests** write access on whatever repo you point `--path` at (a
  fine-grained token scoped to just that repo is the safer choice; create
  one at
  [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new))
- **An LLM API key** from any OpenAI-compatible provider (OpenAI itself, or
  a compatible endpoint like Groq)

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/enismustafaj/apiweiser-scanner/main/install.sh | sh
```

Installs the CLI globally _and_ sets up the codemod skill (see
[Configure](#configure)) for whichever coding agent is on your `PATH` in one
step. Or do both manually:

```sh
npm install -g apiweiser-cli
npx codemod ai --harness claude --user --no-interactive   # swap claude for codex if that's what you use
```

Or run it without installing:

```sh
npx apiweiser-cli --path <path-to-repo>
```

Or clone this repo and run it from source (no build step - Node runs the
`.ts` files directly):

```sh
git clone https://github.com/enismustafaj/apiweiser-scanner.git
cd apiweiser-scanner
npm install
node src/main.ts --path <path-to-repo>
```

## Configure

Every run needs `~/.apiweiser-cli/config.json` filled in — even a plain
scan, since the process always starts three daily background schedulers
alongside it (see [Usage](#usage)). Run the CLI once with no config and it
creates a template for you there, then exits with an error telling you to
fill it in:

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

| Field                 | What it's for                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `llm.apiKey`          | Your API key for whichever provider `llm.url` points at                                            |
| `llm.url`             | An OpenAI-compatible `baseURL` — `https://api.openai.com/v1`, or a compatible provider like Groq   |
| `llm.model`           | Model name at that endpoint                                                                        |
| `codingAgent.command` | `"claude"` for Claude Code, `"codex"` for Codex - whichever you have installed                     |
| `codingAgent.args`    | Flags that put that CLI into non-interactive mode - `["-p"]` for Claude Code, `["exec"]` for Codex |
| `github.token`        | The PAT from [Prerequisites](#prerequisites) above                                                 |

`codingAgent` also needs the codemod skill installed for it (see
[Install](#install) above) - without it, your coding agent won't know how
to build a codemod package (see
[`docs/change-requests.md`](docs/change-requests.md)).

## Usage

There's only one flag, and it's required:

```sh
node src/main.ts --path <path-to-repo>
```

Scans `<path-to-repo>` once (generates its SBOM, records its dependencies,
finds every call site, and queues anything brand new for a
changelog-source lookup), then settles into a long-running process running
three daily schedulers against `<path-to-repo>`, in order: draining the
changelog-lookup queue, classifying releases as breaking or not, and
checking Renovate for version update suggestions. Whenever a suggestion
turns out to already be classified as breaking, the automation kicks in: a
coding agent builds and tests a codemod for the migration, applies it, and
opens a PR — no further action needed from you beyond reviewing it. Safe to
re-run the scan part — unchanged dependencies are skipped entirely, so
it's fast even on a large repo. Leave the process running.

All state lives in `~/.apiweiser-cli/` — the sqlite db, the config file,
SBOM/Renovate caches, and generated codemod packages — separate from
whatever repo you point `--path` at.

## What to expect

- **The first scan of a large repo can take a few minutes** the first
  time, dominated by the SBOM/dependency-scanning tooling; re-scans are
  fast since only new or version-changed dependencies get re-processed.
- **Not every breaking update gets a PR.** If your repo's actual call
  sites don't touch whatever part of the API changed, the generated
  codemod correctly makes no changes, and no PR is opened — that's
  expected, not a bug.
- **A change request can take several minutes.** Building and testing a
  codemod is a real coding-agent session, not a single API call.
- **PRs are opened directly on the repo `--path` points at** (from a
  branch named `apiweiser-cli/<package>-<version>`), not a fork. Point
  this at a repo you (or your token) actually have write access to.

## Asking about what it found

Everything above runs unattended, which makes "what did it actually do?" a
real question. The package ships a second binary, `apiweiser-mcp` — a
read-only MCP server over the same local database — so you can ask the
coding agent you already have open:

```sh
claude mcp add apiweiser -- apiweiser-mcp
```

Then, in that agent: _"which PRs has apiweiser opened?"_, _"why is there no
PR for chalk?"_, _"what breaking releases did it find this week?"_, _"where
do we actually call chalk?"_

It reads `~/.apiweiser-cli/db.sqlite` directly and needs no config of its
own. See [`docs/mcp.md`](docs/mcp.md) for the full tool list and for
setting it up with other agents.

## Docker

```sh
docker build -t apiweiser-cli .
docker run --rm \
  -v "$(pwd)":/repo:ro \
  -v apiweiser-cli-state:/root/.apiweiser-cli \
  apiweiser-cli --path /repo
```

The repo being scanned is mounted read-only at `/repo`. The named volume
persists `~/.apiweiser-cli/` (db, config, caches) across runs — drop it and
you lose scan history/config. Every run is long-running (see
[Usage](#usage)), so add `-d` to run detached rather than blocking the
terminal.

## Development

```sh
npm test           # node's built-in test runner
npm run format      # prettier --write
npm run format:check
```

Local dev never needs a build - Node's native TypeScript support runs the
`src/**/*.ts` files directly.

### Publishing

`npm run build` compiles `src/` to plain `.js` in `dist/` (see
`tsconfig.build.json`) - `dist/` is what actually gets published, not
`src/`. This isn't optional for a published package: Node refuses to
type-strip any `.ts` file located under a `node_modules/` directory (a
hard restriction, verified directly, not something a flag works around),
and an installed npm package always lives under one.

To publish: bump `version` in `package.json`, then create a GitHub Release
with a matching tag (e.g. `v1.2.3`) - publishing the release triggers
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which
runs the tests, builds, and runs `npm publish`. Needs an `NPM_TOKEN` repo
secret with publish access.

## How it works

The README above covers using the CLI. For how each piece is actually
built:

- [`docs/scanner.md`](docs/scanner.md) — how `Scanner` resolves call sites
  via ts-morph's type checker (not import-tracing)
- [`docs/database.md`](docs/database.md) — schema, the shared sqlite
  singleton, FK enforcement
- [`docs/data-sources.md`](docs/data-sources.md) — the changelog-source
  lookup queue, and the daily release-analysis/breaking-change classifier
- [`docs/suggestions.md`](docs/suggestions.md) — the Renovate-backed
  version-suggestion module and its cron scheduler
- [`docs/change-requests.md`](docs/change-requests.md) — asking a coding
  agent to build and test a codemod for a breaking update, "the codemod way"
- [`docs/github.md`](docs/github.md) — applying a generated codemod to the
  monitored repo for real and opening a PR for it
- [`docs/mcp.md`](docs/mcp.md) — the read-only MCP server for asking your
  coding agent what the CLI found
- [`docs/config.md`](docs/config.md) — the CLI's config file in more detail
