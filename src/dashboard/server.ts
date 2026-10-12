// No JSX - Node's native TS stripping can't transform it, so pages.ts
// builds HTML via hono/html tagged templates instead.

import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { join } from "node:path";
import type { Database } from "../db/database.ts";
import { DashboardRepository } from "./db/dashboard-repository.ts";
import { dashboardPage, type TabContent } from "./pages.ts";
import type { DashboardState, PackageType, Tab } from "./types.ts";

const STATIC_DIR = join(import.meta.dirname, "static");

const TABS = new Set<Tab>([
  "packages",
  "call-sites",
  "suggestions",
  "pull-requests",
]);

function pageParam(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// Packages default to direct dependencies - transitive ones outnumber them
// ~15:1 on a real repo and are rarely what anyone came to look at.
// `type=all` is the explicit opt-out.
function typeParam(value: string | undefined): PackageType | undefined {
  if (value === "all") return undefined;
  if (value === "transitive") return "transitive";
  return "direct";
}

// No `repo` param means "pick for me": the only repo if there's exactly
// one (the common case - one CLI per repo), otherwise every repo.
// `repo=` (the "All repos" option) always means every repo.
function repoParam(value: string | undefined, repos: string[]): string | undefined {
  if (value === undefined) return repos.length === 1 ? repos[0] : undefined;
  return repos.includes(value) ? value : undefined;
}

export function parseState(query: Record<string, string>, repos: string[]): DashboardState {
  const tab = TABS.has(query.tab as Tab) ? (query.tab as Tab) : "packages";
  return {
    tab,
    repo: repoParam(query.repo, repos),
    q: text(query.q),
    type: tab === "packages" ? typeParam(query.type) : undefined,
    package: text(query.package),
    api: text(query.api),
    page: pageParam(query.page),
  };
}

function tabContent(repository: DashboardRepository, state: DashboardState): TabContent {
  const filter = { repo: state.repo, q: state.q };
  switch (state.tab) {
    case "packages":
      return {
        tab: "packages",
        page: repository.listPackages({ ...filter, type: state.type }, state.page),
        typeCounts: repository.packageTypeCounts(filter),
      };
    case "call-sites":
      if (state.package) {
        return {
          tab: "call-sites",
          packageName: state.package,
          page: repository.listCallSites(
            { ...filter, packageName: state.package, api: state.api },
            state.page,
          ),
          apiSurfaces: repository.apiSurfaceCounts(state.repo, state.package),
        };
      }
      return { tab: "call-sites", page: repository.listCallSiteUsage(filter, state.page) };
    case "suggestions":
      return { tab: "suggestions", page: repository.listSuggestions(filter, state.page) };
    case "pull-requests":
      return { tab: "pull-requests", page: repository.listPullRequests(filter, state.page) };
  }
}

export function createServer(db: Database): Hono {
  const dashboardRepository = new DashboardRepository(db);
  const app = new Hono();

  app.get("/", (c) => {
    const repos = dashboardRepository.listRepos();
    const state = parseState(c.req.query(), repos);

    return c.html(
      dashboardPage({
        state,
        repos,
        summary: dashboardRepository.summary(state.repo),
        content: tabContent(dashboardRepository, state),
      }),
    );
  });

  app.use("/*", serveStatic({ root: STATIC_DIR }));

  return app;
}
