# apiweiser-cli

Dependency upgrades for coding agents. `apiweiser-cli` does the deterministic
parts of an upgrade - where each package is used, which updates exist and
which packages must move together, the release notes for the exact version
range, and where the codemod for that upgrade lives - and prints each answer
as JSON. Your coding agent (Claude Code or Codex), guided by the bundled
skill, does the judgement: reading the notes, finding or writing a codemod,
applying it, and fixing what's left.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/enismustafaj/apiweiser-scanner/main/install.sh | sh
```

Installs the CLI globally, then the `upgrade-dependency` skill and Codemod's
skill (which it builds on) for whichever coding agent is on your `PATH`. It
also adds a short rule to the agent's user-level instructions file
(`~/.codex/AGENTS.md` for Codex, `~/.claude/CLAUDE.md` for Claude Code) to use
the skill for every dependency upgrade - agents otherwise skip skills when an
upgrade looks easy. The rule sits between `<!-- apiweiser-cli:start -->` and
`<!-- apiweiser-cli:end -->`; reinstalling replaces only that block. With npm
alone:

```sh
npm install -g apiweiser-cli
apiweiser-cli skill install            # or: --harness claude|codex
```

Then ask your agent to upgrade a dependency ("upgrade react to 19", "what can
I upgrade?").

**Prerequisites**: Node.js 22+, git, and a repo with its dependencies
installed (`node_modules` from npm, Yarn or pnpm - Yarn Plug'n'Play isn't
supported). No config file is needed. Set `GITHUB_TOKEN` (no scopes
needed) for release notes: without it GitHub allows 60 API requests an hour
per IP, and one large upgrade can use them up.

## Commands

Every command prints one JSON document to stdout (logs go to stderr). On
failure it prints `{ "error": "..." }` and exits 1. The skill
(`skills/upgrade-dependency/SKILL.md`) documents every field and how an agent uses it.

| Command                                    | Does                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scan --path <repo>`                       | Records the repo's dependencies and where each is called ([docs/scanner.md](docs/scanner.md))                                                                        |
| `plan --path <repo> [--package <name>]...` | Groups available updates by what must move together, with known vulnerabilities ([docs/plan.md](docs/plan.md), [docs/upgrade-grouping.md](docs/upgrade-grouping.md)) |
| `changelog --path <repo> --group <id>`     | Writes each package's release notes for the range to a Markdown file ([docs/changelogs.md](docs/changelogs.md))                                                      |
| `codemod --path <repo> --group <id>`       | Finds each package's codemod, locally and in the `@apiweiser` registry ([docs/codemods.md](docs/codemods.md))                                                        |
| `skill install [--harness claude\|codex]`  | Installs the `upgrade-dependency` and Codemod skills for your agent, and the rule to use them                                                                        |
| `dashboard [--port 3000]`                  | A local, read-only web view over the database ([docs/dashboard.md](docs/dashboard.md))                                                                               |

`scan` comes first; the others read what it recorded. A typical round, as
the skill drives it:

```sh
apiweiser-cli scan --path .
apiweiser-cli plan --path . --package react
apiweiser-cli changelog --path . --group react@19.0.0+react-dom@19.0.0
apiweiser-cli codemod --path . --group react@19.0.0+react-dom@19.0.0
# the agent installs the group, applies or writes the codemods, verifies,
# then rescans so the next plan starts from the new versions
apiweiser-cli scan --path .
```

From source (no build step - Node runs the `.ts` files directly):

```sh
git clone https://github.com/enismustafaj/apiweiser-scanner.git
cd apiweiser-scanner && npm install
node src/main.ts scan --path <path-to-repo>
```

All state lives in `~/.apiweiser-cli/` - the sqlite database
([docs/database.md](docs/database.md)), Renovate reports, release-note files
and the local codemod registry - separate from any repo you point it at.

## What to expect

- **`plan` takes 15-20 seconds** - most of it is Renovate. The other
  commands take a few seconds.
- **One major at a time.** `plan` proposes the next major, not the latest;
  a jump across several majors takes several rounds.
- **Call sites are found in TypeScript and JavaScript** (`require()`
  included): calls, `new`, JSX components, `extends`/`implements` and type
  references. `.vue`/`.svelte` files aren't read yet, and a package that's
  only attached at runtime (express's `app.use` without `@types/express`)
  can't be resolved.
- **devDependencies are never scanned for call sites** - dev tooling isn't
  called from application code.

## Docker

```sh
docker build -t apiweiser-cli .
docker run --rm \
  -v "$(pwd)":/repo:ro \
  -v apiweiser-cli-state:/root/.apiweiser-cli \
  apiweiser-cli scan --path /repo
```

The repo is mounted read-only at `/repo`; the named volume keeps
`~/.apiweiser-cli/` across runs.
