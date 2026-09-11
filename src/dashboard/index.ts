import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { db } from "../db/singleton.ts";
import { createServer } from "./server.ts";

export class DashboardModule {
  start(port: number): ServerType {
    const app = createServer(db);
    const server = serve({ fetch: app.fetch, port });
    console.log(`Dashboard listening on http://localhost:${port}`);
    return server;
  }
}
