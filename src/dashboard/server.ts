import { Hono } from "hono";
import type { Database } from "../db/database.ts";
import { DashboardRepository } from "./db/dashboard-repository.ts";

export function createServer(db: Database): Hono {
  const dashboardRepository = new DashboardRepository(db);
  const app = new Hono();

  app.get("/api/packages", (c) => c.json(dashboardRepository.listPackages()));
  app.get("/api/suggestions", (c) => c.json(dashboardRepository.listSuggestions()));
  app.get("/api/pull-requests", (c) => c.json(dashboardRepository.listPullRequests()));

  return app;
}
