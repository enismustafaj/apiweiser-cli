import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { basename } from "node:path";
import { PAGE_SIZE } from "./db/dashboard-repository.ts";
import type {
  ApiSurfaceCount,
  CallSiteRow,
  CallSiteUsageRow,
  DashboardState,
  Page,
  PackageRow,
  PackageType,
  PullRequestRow,
  SuggestionRow,
  Summary,
  Tab,
} from "./types.ts";

type Fragment = HtmlEscapedString | Promise<HtmlEscapedString>;

// Only the active tab is queried and rendered, so this is a union keyed
// on `tab` rather than one field per table.
export type TabContent =
  | { tab: "packages"; page: Page<PackageRow>; typeCounts: Record<PackageType, number> }
  | { tab: "call-sites"; page: Page<CallSiteUsageRow> }
  | {
      tab: "call-sites";
      packageName: string;
      page: Page<CallSiteRow>;
      apiSurfaces: ApiSurfaceCount[];
    }
  | { tab: "suggestions"; page: Page<SuggestionRow> }
  | { tab: "pull-requests"; page: Page<PullRequestRow> };

export interface DashboardView {
  state: DashboardState;
  repos: string[];
  summary: Summary;
  content: TabContent;
}

// How many API chips show before the rest fold into "N more".
const VISIBLE_API_SURFACES = 12;

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`;
}

// Stored timestamps are SQLite's "YYYY-MM-DD HH:MM:SS" (UTC). The date is
// what matters at a glance; the full timestamp stays on hover.
function date(timestamp: string): Fragment {
  return html`<time datetime="${timestamp}" title="${timestamp} UTC"
    >${timestamp.slice(0, 10)}</time
  >`;
}

// Repo paths are absolute and can be very long (a scratch checkout under
// /private/tmp runs to ~250 chars), so show the directory name and keep
// the full path on hover.
function repoCell(repoPath: string): Fragment {
  return html`<span class="repo-name" title="${repoPath}">${basename(repoPath)}</span>`;
}

// ---------------------------------------------------------------------------
// URLs. Every link is a full navigation carrying the whole state in the
// query string, same as the filter forms - no client-side state.

type Query = Partial<Record<keyof DashboardState, string | number | undefined>>;

function stateQuery(state: DashboardState): Query {
  return {
    tab: state.tab,
    repo: state.repo,
    q: state.q,
    // Packages without a type means "all" - spelled out, since a missing
    // `type` means the direct-only default.
    type: state.tab === "packages" ? (state.type ?? "all") : undefined,
    package: state.package,
    api: state.api,
    page: state.page > 1 ? state.page : undefined,
  };
}

function href(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

// Switching tabs keeps the repo and the search, and drops everything that
// only means something on the tab being left.
function tabHref(state: DashboardState, tab: Tab, extra: Query = {}): string {
  return href({ tab, repo: state.repo, q: state.q, ...extra });
}

// ---------------------------------------------------------------------------
// Shared pieces

function updateTypeBadge(updateType: string): Fragment {
  const known = new Set(["major", "minor", "patch"]);
  const cls = known.has(updateType) ? `badge-${updateType}` : "badge-default";
  return html`<span class="badge ${cls}">${updateType}</span>`;
}

function paginationControls(state: DashboardState, page: Page<unknown>): Fragment {
  if (page.total === 0) return html``;
  const first = (page.page - 1) * PAGE_SIZE + 1;
  const last = first + page.rows.length - 1;
  const range =
    page.rows.length > 0
      ? html`${fmt(first)}–${fmt(last)} of ${fmt(page.total)}`
      : html`${fmt(page.total)} total`;
  const pageHref = (p: number) => href({ ...stateQuery(state), page: p > 1 ? p : undefined });

  return html`<nav class="pagination" aria-label="Pages">
    <span class="range">${range}</span>
    ${
      page.totalPages > 1
        ? html`<span class="pager">
            ${
              page.page > 1
                ? html`<a href="${pageHref(page.page - 1)}">← Prev</a>`
                : html`<span>← Prev</span>`
            }
            <span>Page ${page.page} of ${page.totalPages}</span>
            ${
              page.page < page.totalPages
                ? html`<a href="${pageHref(page.page + 1)}">Next →</a>`
                : html`<span>Next →</span>`
            }
          </span>`
        : ""
    }
  </nav>`;
}

// The Repo column only shows across repos - once one is selected every
// row would repeat the same value.
function showRepoColumn(state: DashboardState): boolean {
  return state.repo === undefined;
}

function empty(message: Fragment | string): Fragment {
  return html`<p class="empty">${message}</p>`;
}

// ---------------------------------------------------------------------------
// Top bar: brand / repo breadcrumb

function repoCrumb(state: DashboardState, repos: string[]): Fragment {
  if (repos.length === 0) return html``;

  if (repos.length === 1) {
    return html`<span class="crumb-sep">/</span>
      <span class="crumb" title="${repos[0]}">${basename(repos[0]!)}</span>`;
  }

  // Only the tab carries over; filters specific to the old repo (package,
  // api, page) are dropped since they may not exist in the new one.
  return html`<span class="crumb-sep">/</span>
    <form class="crumb-picker" method="get" action="/">
      <input type="hidden" name="tab" value="${state.tab}" />
      <label>
        <span class="visually-hidden">Repository</span>
        <select name="repo" onchange="this.form.submit()">
          <option value="" ${state.repo === undefined ? "selected" : ""}>
            All repos (${repos.length})
          </option>
          ${repos.map(
            (repo) =>
              html`<option value="${repo}" title="${repo}" ${state.repo === repo ? "selected" : ""}>
                ${basename(repo)}
              </option>`,
          )}
        </select>
      </label>
      <noscript><button type="submit">Go</button></noscript>
    </form>`;
}

// ---------------------------------------------------------------------------
// Page heading - what the active view is, and which repo it's over

const TAB_HEADINGS: Record<Tab, { title: string; description: string }> = {
  packages: {
    title: "Dependencies",
    description: "What the code depends on — direct dependencies first, most-called first.",
  },
  "call-sites": {
    title: "Call sites",
    description: "Every place the code calls a dependency directly.",
  },
  suggestions: {
    title: "Suggested updates",
    description: "Newer versions Renovate found for your dependencies.",
  },
  "pull-requests": {
    title: "Pull requests",
    description: "Migration PRs opened so far.",
  },
};

function pageHeading(state: DashboardState): Fragment {
  const { title, description } = TAB_HEADINGS[state.tab];
  return html`<div class="page-heading">
    <div>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
    ${state.repo ? html`<code class="repo-path" title="${state.repo}">${state.repo}</code>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// Metrics strip - each metric *is* a tab, so each number is also the way in.

function summaryCards(state: DashboardState, summary: Summary): Fragment {
  const card = (
    tab: Tab,
    value: number,
    label: string,
    detail: string,
    extra: Query = {},
  ) =>
    html`<a
      class="metric"
      href="${tabHref(state, tab, extra)}"
      aria-current="${state.tab === tab ? "page" : "false"}"
    >
      <span class="metric-label">${label}</span>
      <strong>${fmt(value)}</strong>
      <span class="metric-detail">${detail}</span>
    </a>`;

  return html`<nav class="metrics" aria-label="Sections">
    ${card("packages", summary.direct, "Direct deps", `+ ${fmt(summary.transitive)} transitive`, {
      type: "direct",
    })}
    ${card(
      "call-sites",
      summary.callSites,
      "Call sites",
      `in ${plural(summary.packagesWithCallSites, "package")}`,
    )}
    ${card("suggestions", summary.suggestions, "Updates", "suggested by Renovate")}
    ${card("pull-requests", summary.pullRequests, "PRs", "migrations opened")}
  </nav>`;
}

// ---------------------------------------------------------------------------
// Toolbar: search, plus the direct/transitive toggle on packages

const SEARCH_PLACEHOLDER: Record<Tab, string> = {
  packages: "Search packages…",
  "call-sites": "Search packages…",
  suggestions: "Search dependencies…",
  "pull-requests": "Search packages…",
};

function toolbar(state: DashboardState, content: TabContent): Fragment {
  const placeholder =
    state.tab === "call-sites" && state.package
      ? "Search files and code…"
      : SEARCH_PLACEHOLDER[state.tab];

  const searchForm = html`<form class="search" method="get" action="/" role="search">
    <input type="hidden" name="tab" value="${state.tab}" />
    ${state.repo ? html`<input type="hidden" name="repo" value="${state.repo}" />` : ""}
    ${
      state.tab === "packages"
        ? html`<input type="hidden" name="type" value="${state.type ?? "all"}" />`
        : ""
    }
    ${state.package ? html`<input type="hidden" name="package" value="${state.package}" />` : ""}
    ${state.api ? html`<input type="hidden" name="api" value="${state.api}" />` : ""}
    <svg class="search-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
    <input
      type="search"
      name="q"
      value="${state.q ?? ""}"
      placeholder="${placeholder}"
      aria-label="${placeholder}"
    />
    <kbd aria-hidden="true">/</kbd>
    ${
      state.q
        ? html`<a
            class="clear"
            href="${href({ ...stateQuery(state), q: undefined, page: undefined })}"
            >Clear</a
          >`
        : ""
    }
  </form>`;

  if (content.tab !== "packages") return html`<div class="toolbar">${searchForm}</div>`;

  const { direct, transitive } = content.typeCounts;
  const option = (value: PackageType | "all", label: string, count: number) => {
    const active = (state.type ?? "all") === value;
    return html`<a
      href="${href({ ...stateQuery(state), type: value, page: undefined })}"
      aria-current="${active ? "true" : "false"}"
      >${label} <span class="count">${fmt(count)}</span></a
    >`;
  };

  return html`<div class="toolbar">
    ${searchForm}
    <nav class="segmented" aria-label="Dependency type">
      ${option("direct", "Direct", direct)} ${option("transitive", "Transitive", transitive)}
      ${option("all", "All", direct + transitive)}
    </nav>
  </div>`;
}

// ---------------------------------------------------------------------------
// Tab panels

// A count plus a thin bar scaled against the largest count on the page, so
// the heavy hitters stand out without reading every number.
function usage(count: number, max: number, link: string): Fragment {
  const width = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return html`<a class="usage" href="${link}">
    <span class="usage-bar"><span style="width: ${width}%"></span></span>
    <span class="usage-count">${fmt(count)}</span>
  </a>`;
}

function packagesPanel(state: DashboardState, page: Page<PackageRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(
      state.q
        ? html`No packages match “${state.q}”.`
        : html`No packages scanned yet. Run <code>apiweiser-cli scan --path &lt;repo&gt;</code>.`,
    );
  }
  const repoColumn = showRepoColumn(state);
  const typeColumn = state.type === undefined;
  const maxCallSites = Math.max(...page.rows.map((r) => r.callSites));

  return html`<table>
    <thead>
      <tr>
        ${repoColumn ? html`<th>Repo</th>` : ""}
        <th>Package</th>
        <th>Version</th>
        ${typeColumn ? html`<th>Type</th>` : ""}
        <th class="num">Call sites</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (r) =>
          html`<tr>
            ${repoColumn ? html`<td>${repoCell(r.repoPath)}</td>` : ""}
            <td><strong>${r.name}</strong></td>
            <td><code>${r.currentVersion}</code></td>
            ${typeColumn ? html`<td><span class="pill">${r.type}</span></td>` : ""}
            <td class="num">
              ${
                r.callSites > 0
                  ? usage(
                      r.callSites,
                      maxCallSites,
                      tabHref(state, "call-sites", { q: undefined, package: r.name }),
                    )
                  : html`<span class="muted">—</span>`
              }
            </td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function callSiteUsagePanel(state: DashboardState, page: Page<CallSiteUsageRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(
      state.q
        ? html`No call sites for packages matching “${state.q}”.`
        : "No call sites recorded yet.",
    );
  }
  const repoColumn = showRepoColumn(state);
  const maxCallSites = Math.max(...page.rows.map((u) => u.callSites));
  const packageHref = (name: string) =>
    tabHref(state, "call-sites", { q: undefined, package: name });

  return html`<table>
    <thead>
      <tr>
        ${repoColumn ? html`<th>Repo</th>` : ""}
        <th>Package</th>
        <th class="num">Call sites</th>
        <th class="num">Files</th>
        <th class="num">APIs used</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (u) =>
          html`<tr>
            ${repoColumn ? html`<td>${repoCell(u.repoPath)}</td>` : ""}
            <td>
              <a href="${tabHref(state, "call-sites", { q: undefined, package: u.packageName })}"
                ><strong>${u.packageName}</strong></a
              >
              ${u.type === "transitive" ? html`<span class="pill">transitive</span>` : ""}
            </td>
            <td class="num">${usage(u.callSites, maxCallSites, packageHref(u.packageName))}</td>
            <td class="num">${fmt(u.files)}</td>
            <td class="num">${fmt(u.apiSurfaces)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

// A snippet is whatever expression the scanner matched, which can be a
// 100-line chained call. Show the first line and fold the rest.
function snippetCell(snippet: string): Fragment {
  const lines = snippet.split("\n");
  if (lines.length === 1) return html`<code>${snippet}</code>`;
  return html`<details class="snippet">
    <summary>
      <code>${lines[0]}</code> <span class="muted">+${lines.length - 1} lines</span>
    </summary>
    <pre><code>${snippet}</code></pre>
  </details>`;
}

function apiSurfaceChips(
  state: DashboardState,
  apiSurfaces: ApiSurfaceCount[],
  total: number,
): Fragment {
  if (apiSurfaces.length <= 1) return html``;
  const chip = (api: string | undefined, label: string, count: number) =>
    html`<a
      class="chip"
      href="${href({ ...stateQuery(state), api, page: undefined })}"
      aria-current="${state.api === api ? "true" : "false"}"
      >${label} <span class="count">${fmt(count)}</span></a
    >`;
  const visible = apiSurfaces.slice(0, VISIBLE_API_SURFACES);
  const rest = apiSurfaces.slice(VISIBLE_API_SURFACES);
  // Keep a selected API visible even if it's past the fold.
  const selectedHidden = rest.find((a) => a.apiSurface === state.api);

  return html`<div class="chips" aria-label="Filter by API">
    ${chip(undefined, "All APIs", total)}
    ${visible.map((a) => chip(a.apiSurface, a.apiSurface, a.count))}
    ${selectedHidden ? chip(selectedHidden.apiSurface, selectedHidden.apiSurface, selectedHidden.count) : ""}
    ${
      rest.length > 0
        ? html`<details class="more">
            <summary>${rest.length} more</summary>
            ${rest.map((a) => chip(a.apiSurface, a.apiSurface, a.count))}
          </details>`
        : ""
    }
  </div>`;
}

function callSitesPanel(
  state: DashboardState,
  packageName: string,
  page: Page<CallSiteRow>,
  apiSurfaces: ApiSurfaceCount[],
): Fragment {
  const total = apiSurfaces.reduce((sum, a) => sum + a.count, 0);
  const repoColumn = showRepoColumn(state);

  return html`<div class="drilldown">
      <a href="${tabHref(state, "call-sites", { q: undefined })}">← All packages</a>
      <h2>${packageName}</h2>
      <span class="muted"
        >${plural(total, "call site")} across ${plural(apiSurfaces.length, "API")}</span
      >
    </div>
    ${apiSurfaceChips(state, apiSurfaces, total)}
    ${
      page.rows.length === 0
        ? empty(
            state.q || state.api
              ? "No call sites match these filters."
              : html`No call sites recorded for ${packageName}.`,
          )
        : html`<table class="call-sites">
            <thead>
              <tr>
                ${repoColumn ? html`<th>Repo</th>` : ""}
                <th>Location</th>
                <th>API</th>
                <th>Code</th>
              </tr>
            </thead>
            <tbody>
              ${page.rows.map(
                (c) =>
                  html`<tr>
                    ${repoColumn ? html`<td>${repoCell(c.repoPath)}</td>` : ""}
                    <td class="location">
                      <code title="${c.file}:${c.line}">${c.file}:${c.line}</code>
                    </td>
                    <td><code>${c.apiSurface}</code></td>
                    <td class="code">${snippetCell(c.snippet)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
    }`;
}

function suggestionsPanel(state: DashboardState, page: Page<SuggestionRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(
      state.q
        ? html`No suggestions for dependencies matching “${state.q}”.`
        : "No suggestions yet — Renovate checks for updates daily.",
    );
  }
  const repoColumn = showRepoColumn(state);

  return html`<table>
    <thead>
      <tr>
        ${repoColumn ? html`<th>Repo</th>` : ""}
        <th>Dependency</th>
        <th>Update</th>
        <th>Type</th>
        <th>Found</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (s) =>
          html`<tr>
            ${repoColumn ? html`<td>${repoCell(s.repoPath)}</td>` : ""}
            <td><strong>${s.dependency}</strong></td>
            <td><code>${s.currentVersion} → ${s.newVersion}</code></td>
            <td>${updateTypeBadge(s.updateType)}</td>
            <td>${date(s.scannedAt)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function pullRequestsPanel(state: DashboardState, page: Page<PullRequestRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(state.q ? html`No PRs for packages matching “${state.q}”.` : "No PRs opened yet.");
  }
  const repoColumn = showRepoColumn(state);

  return html`<table>
    <thead>
      <tr>
        ${repoColumn ? html`<th>Repo</th>` : ""}
        <th>Package</th>
        <th>Migration</th>
        <th>PR</th>
        <th>Opened</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (pr) =>
          html`<tr>
            ${repoColumn ? html`<td>${repoCell(pr.repoPath)}</td>` : ""}
            <td><strong>${pr.packageName}</strong></td>
            <td><code>${pr.version} → ${pr.newVersion}</code></td>
            <td><a href="${pr.url}" target="_blank" rel="noopener">View PR ↗</a></td>
            <td>${date(pr.openedAt)}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function panel(state: DashboardState, content: TabContent): Fragment {
  switch (content.tab) {
    case "packages":
      return packagesPanel(state, content.page);
    case "call-sites":
      return "packageName" in content
        ? callSitesPanel(state, content.packageName, content.page, content.apiSurfaces)
        : callSiteUsagePanel(state, content.page);
    case "suggestions":
      return suggestionsPanel(state, content.page);
    case "pull-requests":
      return pullRequestsPanel(state, content.page);
  }
}

// ---------------------------------------------------------------------------

export function dashboardPage({ state, repos, summary, content }: DashboardView): Fragment {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${state.repo ? `${basename(state.repo)} · ` : ""}APIWeiser</title>
        <link rel="icon" href="/logo-mark.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header class="topbar">
          <div class="shell topbar-inner">
            <a class="brand" href="/" aria-label="APIWeiser home">
              <img src="/logo-mark.png" alt="" class="brand-mark" />
              <span class="brand-name">API<span>Weiser</span></span>
            </a>
            ${repoCrumb(state, repos)}
            <span class="status" title="Reading ~/.apiweiser-cli/db.sqlite">
              <span class="status-dot"></span>Local · read-only
            </span>
          </div>
        </header>

        <main class="shell">
          ${pageHeading(state)} ${summaryCards(state, summary)}
          <section class="panel">
            ${toolbar(state, content)}
            <div class="table-wrap">${panel(state, content)}</div>
            ${paginationControls(state, content.page)}
          </section>
        </main>

        <footer class="shell footer">
          <span>APIWeiser</span>
          <span>Reading <code>~/.apiweiser-cli/db.sqlite</code></span>
        </footer>

        <script>
          // "/" jumps to search, like most dev tools.
          document.addEventListener("keydown", (e) => {
            const search = document.querySelector('input[type="search"]');
            if (e.key !== "/" || !search || e.target instanceof HTMLInputElement) return;
            e.preventDefault();
            search.focus();
          });
        </script>
      </body>
    </html>`;
}
