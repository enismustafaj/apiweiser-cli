# apiweiser-cli

A tool that watches a repo's dependencies for you: it finds where each one
is actually used in your code, tracks version updates as they're proposed,
and has a coding agent write, test, and open a PR for each upgrade —
migrating your call sites when the changelog says they need it.

## What it does

1. **Scan** (`--path`/`--repo`) — reads your repo's SBOM, records every
   dependency, and finds every place in your source each one is actually
   called.
2. **Look up changelogs** (daily) — for any dependency it's never seen
   before, figures out where its GitHub releases live.
3. **Track suggestions** (daily) — runs Renovate to see what version
   updates are available, picks one target version per package, and groups
   packages whose peer dependencies mean they must move together (see
   [`docs/upgrade-grouping.md`](docs/upgrade-grouping.md)).
4. **Raise change requests** (right after 3, once per group) — asks an LLM
   to summarize the GitHub releases between the current and new version,
   then asks a coding agent to build and test a codemod for the migration,
   bumps the versions, applies the codemod, and opens a PR.

Steps 2 and 3 each run once a day, in that order, for as long as the
process keeps running — or, with `--once`, right after the scan, and then
the process exits.

There's no breaking-change filter: every group gets a change request, minor
and patch updates included. Groups are skipped only when the scan found no
call sites for any of their packages or none of their changelogs could be
summarized. devDependencies are never scanned for call sites, so upgrades
of dev tooling alone (`eslint`, `typescript`, `@types/*`, ...) are always
skipped. A devDependency only gets bumped as a peer of a runtime package
that's being upgraded.

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
scan, since every run goes on to the changelog-lookup and suggestion jobs
(see [Usage](#usage)). Run the CLI once with no config and it
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
| `llm.model`           | Model name at that endpoint - used to summarize changelogs for the coding agent                    |
| `codingAgent.command` | `"claude"` for Claude Code, `"codex"` for Codex - whichever you have installed                     |
| `codingAgent.args`    | Flags that put that CLI into non-interactive mode - `["-p"]` for Claude Code, `["exec"]` for Codex |
| `github.token`        | The PAT from [Prerequisites](#prerequisites) above                                                 |

Optionally, `codemodRegistry` (`{ "mode": "local" }` by default) controls
where generated codemods are shared: `"local"` keeps them under
`~/.apiweiser-cli/codemods/`, `"remote"` also searches and publishes to the
Codemod registry and needs `scope` and `apiKey` - see
[`docs/change-requests.md`](docs/change-requests.md) § Remote registry.

`codingAgent` also needs the codemod skill installed for it (see
[Install](#install) above) - without it, your coding agent won't know how
to build a codemod package (see
[`docs/change-requests.md`](docs/change-requests.md)).

## Usage

Point it at exactly one of a local path or a git URL:

```sh
node src/main.ts scan --path <path-to-repo>
node src/main.ts scan --repo <git-url>
```

`--repo` clones the URL (or pulls latest, if it's already been cloned by a
previous run) into `~/.apiweiser-cli/repos/<owner>-<repo>/` and scans that
instead — everything after this point behaves identically either way.

Scans the repo once (generates its SBOM, records its dependencies, finds
every call site, and queues anything brand new for a changelog-source
lookup), then settles into a long-running process running two daily
schedulers (at midnight), in order: draining the changelog-lookup queue,
then checking Renovate for version update suggestions. Each upgrade group
Renovate's suggestions produce goes straight to a coding agent, which
builds and tests a codemod for the migration; the versions are bumped, the
codemod applied, and a PR opened — no further action needed from you
beyond reviewing it. Safe to re-run the scan part —
unchanged dependencies are skipped entirely, so it's fast even on a large
repo. Leave the process running.

To run everything once instead — scan, changelog lookups, suggestions and
any PRs, right away — and exit, add `--once`:

```sh
node src/main.ts scan --repo <git-url> --once
```

Handy for trying it out, or for driving it from your own cron/CI instead of
leaving a process up.

All state lives in `~/.apiweiser-cli/` — the sqlite db, the config file,
SBOM/Renovate caches, clones made via `--repo`, and generated codemod
packages — separate from whatever repo is actually being scanned.

### Dashboard

```sh
apiweiser-cli dashboard --port 3000
```

A local, read-only web view over that same sqlite db — packages,
suggestions, and PRs opened so far — see
[`docs/dashboard.md`](./docs/dashboard.md).

## What to expect

- **The first scan of a large repo can take a few minutes** the first
  time, dominated by the SBOM/dependency-scanning tooling; re-scans are
  fast since only new or version-changed dependencies get re-processed.
- **Some PRs only bump versions.** If your repo's actual call sites don't
  touch whatever part of the API changed, the generated codemod correctly
  makes no changes — the PR then carries just the `package.json`/lockfile
  bump. That's expected, not a bug.
- **Only function calls and `new` expressions count as call sites.** A
  package your code only uses as JSX components (`<Combobox.Root>`) or
  types records none, so its upgrade is skipped — unless it's grouped with
  a package that does have call sites.
- **A change request can take several minutes.** Building and testing a
  codemod is a real coding-agent session, not a single API call.
- **PRs are opened directly on the repo `--path` points at**, not a fork,
  from a branch like `apiweiser-cli/base-ui/react-1.9.0` (or
  `apiweiser-cli/base-ui/react-1.9.0+date-fns-4.4.0` for a group - see
  [`docs/github.md`](docs/github.md)). Point this at a repo you (or your
  token) actually have write access to.

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
you lose scan history/config. A run is long-running by default (see
[Usage](#usage)), so add `-d` to run detached rather than blocking the
terminal — or append `--once` to run everything once and exit.
