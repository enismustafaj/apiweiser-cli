// No JSX - Node's native TS stripping can't transform it, so pages.ts
// builds HTML via hono/html tagged templates instead.

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { join } from "node:path";
import type { Database } from "../db/database.ts";
import { DashboardRepository } from "./db/dashboard-repository.ts";
import { repoPage, reposPage, type TabContent } from "./pages.ts";
import type { DashboardState, Tab } from "./types.ts";

const STATIC_DIR = join(import.meta.dirname, "static");

// Older links to the suggestions or updates tabs land on pull requests.
// Anything else unknown falls back to packages.
const TAB_ALIASES: Record<string, Tab> = {
  packages: "packages",
  "pull-requests": "pull-requests",
  suggestions: "pull-requests",
  updates: "pull-requests",
};

function pageParam(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// An unknown repo shows the repo list rather than an empty repo view.
export function parseState(query: Record<string, string>, repos: string[]): DashboardState {
  return {
    tab: TAB_ALIASES[query.tab ?? ""] ?? "packages",
    repo: query.repo !== undefined && repos.includes(query.repo) ? query.repo : undefined,
    q: text(query.q),
    page: pageParam(query.page),
  };
}

function tabContent(repository: DashboardRepository, state: DashboardState): TabContent {
  const filter = { repo: state.repo, q: state.q };
  switch (state.tab) {
    case "packages":
      return { tab: "packages", page: repository.listPackages(filter, state.page) };
    case "pull-requests":
      return { tab: "pull-requests", page: repository.listPullRequests(filter, state.page) };
  }
}

export function createServer(db: Database): Hono {
  const dashboardRepository = new DashboardRepository(db);
  const app = new Hono();

  app.get("/", (c) => {
    const repos = dashboardRepository.repoSummaries();
    const state = parseState(
      c.req.query(),
      repos.map((r) => r.repoPath),
    );
    const summary = repos.find((r) => r.repoPath === state.repo);

    if (!summary) return c.html(reposPage(repos));
    return c.html(repoPage({ state, summary, content: tabContent(dashboardRepository, state) }));
  });

  app.use("/*", serveStatic({ root: STATIC_DIR }));

  return app;
}
