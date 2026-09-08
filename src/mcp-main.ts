#!/usr/bin/env node
// Entry point for the MCP server (see docs/mcp.md). Separate from main.ts
// on purpose: main.ts scans and then blocks forever running schedulers,
// while this is launched on demand by an MCP client (Claude Code, Codex,
// ...) and talks JSON-RPC over stdio. Nothing may be written to stdout
// here except that protocol traffic.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { db } from "./db/singleton.ts";
import { createMcpServer } from "./mcp/index.ts";

const server = createMcpServer(db);
await server.connect(new StdioServerTransport());
