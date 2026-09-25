import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { Database } from "../db/database.ts";
import { createServer } from "./server.ts";

export class DashboardModule {
  start(port: number): ServerType {
    const db = new Database(undefined, { migrate: false });
    const app = createServer(db);
    const server = serve({ fetch: app.fetch, port });
    console.log(`Dashboard listening on http://localhost:${port}`);
    return server;
  }
}
