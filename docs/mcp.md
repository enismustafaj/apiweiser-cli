# MCP server

`src/mcp/` — a read-only [MCP](https://modelcontextprotocol.io) server over
the CLI's local sqlite db, so you can ask your coding agent "which PRs did
apiweiser open?" or "what did it classify as breaking?" instead of querying
sqlite by hand.

```
src/mcp-main.ts             bin entry (apiweiser-mcp) - stdio transport
src/mcp/index.ts            createMcpServer(db) - the tool definitions
src/mcp/db/insights-repository.ts  the read queries behind those tools
src/mcp/types.ts            row shapes the tools return
```

## Why it's a separate binary

`main.ts` scans and then blocks forever running the daily schedulers. An
MCP server isn't something you run — the client (Claude Code, Codex, ...)
launches it as a subprocess and talks JSON-RPC to it over stdio. So it gets
its own `bin` (`apiweiser-mcp`) rather than a flag on the existing one, and
it must never write anything to stdout except protocol traffic.

Both processes open the same db file. That's the point (the MCP reads what
a running CLI writes), and it's why every tool here is read-only — a tool
that could mutate would be racing the schedulers in the other process.

## Setup

Register it with whichever agent you use. For Claude Code:

```sh
claude mcp add apiweiser -- apiweiser-mcp
```

Or add it to a project's `.mcp.json` by hand:

```json
{
  "mcpServers": {
    "apiweiser": { "command": "apiweiser-mcp", "args": [] }
  }
}
```

Running from a clone instead of an install:

```json
{
  "mcpServers": {
    "apiweiser": { "command": "node", "args": ["/path/to/apiweiser-cli/src/mcp-main.ts"] }
  }
}
```

It reads `~/.apiweiser-cli/db.sqlite`, the same db the CLI writes — so it
answers for whatever repos you've pointed `--path` at, no config of its
own.

## Tools

| Tool                    | Answers                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `overview`              | What has this found overall? Repos scanned, counts, change-request outcomes |
| `list_change_requests`  | Which PRs were raised — and, for attempts that produced none, why not       |
| `list_breaking_changes` | Which releases were classified breaking, and what broke                     |
| `list_suggestions`      | Which version updates Renovate proposed                                     |
| `list_dependencies`     | What's tracked, and how many call sites each dependency has                 |
| `find_call_sites`       | Where a dependency is actually called, file and line                        |

All list tools take an optional `packageName` and a `limit` (default 50,
max 500).

### `list_change_requests` covers more than PRs

One row per _attempt_, not per PR, because "why is there no PR for chalk?"
is the more common question. `status` is one of:

| status           | meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `pr_opened`      | PR opened; `prUrl` has the link                                      |
| `skipped`        | No PR, on purpose — codemod changed nothing, or origin isn't GitHub  |
| `codemod_failed` | The coding agent couldn't build a working codemod; `detail` says why |
| `pr_failed`      | The PR flow itself errored; `detail` has the error                   |

`skipped` is a normal outcome, not a failure: if the repo's call sites
don't touch the part of the API that changed, the correct codemod makes no
changes (see [`docs/change-requests.md`](./change-requests.md)).

These rows are written by `ChangeRequestsModule` (see
[`docs/change-requests.md`](./change-requests.md)) into the
`change_requests` table. Before that table existed, every one of these
outcomes was `console.log`-only — invisible the moment the process
restarted, which is what made this server worth building.

## `InsightsRepository`

The read queries live here rather than on the write-path repositories
because nothing else in the CLI asks these questions: the scanners and
schedulers look up one package at a time (`findResult`, `findChangedOrNew`),
while every query here is a "show me everything that matches" report.

`listCallSites` takes an optional `repoPath`, unlike
`CallSitesRepository.findForDependency`, which requires one — whoever asks
through an agent knows a package name but rarely the absolute path it was
scanned under.
