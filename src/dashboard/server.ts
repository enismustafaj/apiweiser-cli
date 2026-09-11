// Hono app for the dashboard: one server-rendered page (see pages.ts - no
// JSX, Node's native TS stripping can't transform it), plus the
// Pico.css/overrides static/ serves.

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { join } from "node:path";
import type { Database } from "../db/database.ts";
import { DashboardRepository } from "./db/dashboard-repository.ts";
import { dashboardPage } from "./pages.ts";
import type { Tab } from "./types.ts";

const STATIC_DIR = join(import.meta.dirname, "static");

const TABS = new Set<Tab>(["packages", "suggestions", "pull-requests"]);

function pageParam(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

export function createServer(db: Database): Hono {
  const dashboardRepository = new DashboardRepository(db);
  const app = new Hono();

  app.get("/", (c) => {
    const query = c.req.query();
    const activeTab: Tab = TABS.has(query.tab as Tab) ? (query.tab as Tab) : "packages";

    return c.html(
      dashboardPage(
        dashboardRepository.listPackages(pageParam(query.packagesPage)),
        dashboardRepository.listSuggestions(pageParam(query.suggestionsPage)),
        dashboardRepository.listPullRequests(pageParam(query.pullRequestsPage)),
        activeTab,
      ),
    );
  });

  app.use("/*", serveStatic({ root: STATIC_DIR }));

  return app;
}
