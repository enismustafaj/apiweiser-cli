// A read-only MCP server over the local apiweiser-cli database, so the
// coding agent you already have open can answer "what did apiweiser find?"
// - which PRs it raised, what it classified as breaking, what updates are
// waiting - without you reading sqlite by hand. See docs/mcp.md.
//
// Read-only on purpose: this queries the same db the CLI writes to, and a
// tool that could mutate it would be racing the schedulers running in the
// other process.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ChangeRequestsRepository } from "../change-requests/db/change-requests-repository.ts";
import type { ChangeRequestStatus } from "../change-requests/types.ts";
import type { Database } from "../db/database.ts";
import { InsightsRepository } from "./db/insights-repository.ts";

const DEFAULT_LIMIT = 50;

const limit = z
  .number()
  .int()
  .positive()
  .max(500)
  .default(DEFAULT_LIMIT)
  .describe(`Maximum rows to return (default ${DEFAULT_LIMIT}).`);

export function createMcpServer(db: Database): McpServer {
  const insights = new InsightsRepository(db);
  const changeRequests = new ChangeRequestsRepository(db);

  const server = new McpServer({ name: "apiweiser-cli", version: "1.0.0" });

  server.registerTool(
    "overview",
    {
      title: "Overview",
      description:
        "Summary of everything apiweiser-cli has recorded so far: which repos were scanned, how many dependencies and call sites are tracked, how many updates are pending, how many releases were classified breaking, change-request outcomes by status, and when release analysis last ran. Start here when asked a broad question about what the tool has found.",
      inputSchema: {},
    },
    async () => json(insights.overview()),
  );

  server.registerTool(
    "list_change_requests",
    {
      title: "List change requests (PRs raised)",
      description:
        "Every migration apiweiser-cli attempted for a breaking update, newest first - including the pull requests it opened (status 'pr_opened', with prUrl). Also covers attempts that produced no PR: 'skipped' (the codemod applied but changed nothing, or the repo's origin isn't GitHub), 'codemod_failed' (the coding agent couldn't build a working codemod), and 'pr_failed' (the PR flow errored). Use this for any question about PRs raised, or about why a package has no PR.",
      inputSchema: {
        status: z
          .enum(["codemod_failed", "skipped", "pr_opened", "pr_failed"])
          .optional()
          .describe("Only return attempts with this outcome."),
        packageName: z.string().optional().describe("Only return attempts for this package."),
      },
    },
    async ({ status, packageName }) =>
      json(
        changeRequests.findAll({ status: status as ChangeRequestStatus | undefined, packageName }),
      ),
  );

  server.registerTool(
    "list_breaking_changes",
    {
      title: "List breaking changes",
      description:
        "Releases an LLM classified as breaking, newest first, with the summary explaining what broke. This is the classification step - a breaking release here has not necessarily been migrated yet; use list_change_requests for what was done about it.",
      inputSchema: {
        packageName: z.string().optional().describe("Only return releases for this package."),
        limit,
      },
    },
    async ({ packageName, limit }) => json(insights.listBreakingChanges({ packageName, limit })),
  );

  server.registerTool(
    "list_suggestions",
    {
      title: "List available dependency updates",
      description:
        "Version updates Renovate proposed for the scanned repos, newest first. These are available updates, not migrations - being listed here says nothing about whether the update is breaking.",
      inputSchema: {
        packageName: z.string().optional().describe("Only return updates for this dependency."),
        updateType: z
          .string()
          .optional()
          .describe("Only return updates of this type, e.g. 'major', 'minor', 'patch'."),
        limit,
      },
    },
    async ({ packageName, updateType, limit }) =>
      json(insights.listSuggestions({ packageName, updateType, limit })),
  );

  server.registerTool(
    "list_dependencies",
    {
      title: "List tracked dependencies",
      description:
        "Dependencies recorded from scanned repos, with how many call sites each one has, busiest first. A dependency with zero call sites is installed but never actually called in the source.",
      inputSchema: {
        packageName: z.string().optional().describe("Only return this dependency."),
        limit,
      },
    },
    async ({ packageName, limit }) => json(insights.listDependencies({ packageName, limit })),
  );

  server.registerTool(
    "find_call_sites",
    {
      title: "Find where a dependency is used",
      description:
        "Every place a given dependency is actually called in scanned source, with file, line, the calling snippet, and the API surface it resolves to. Use this to judge how much a breaking release actually affects the repo.",
      inputSchema: {
        packageName: z.string().describe("The dependency to look up, e.g. 'chalk'."),
        repoPath: z
          .string()
          .optional()
          .describe("Restrict to one scanned repo path; omit to search all of them."),
        limit,
      },
    },
    async ({ packageName, repoPath, limit }) =>
      json(insights.listCallSites({ packageName, repoPath, limit })),
  );

  return server;
}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}
