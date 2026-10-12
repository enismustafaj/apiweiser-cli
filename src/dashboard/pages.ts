import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PAGE_SIZE } from "./db/dashboard-repository.ts";
import type {
  DashboardState,
  Page,
  PackageRow,
  PullRequestRow,
  RepoSummary,
  Tab,
} from "./types.ts";

type Fragment = HtmlEscapedString | Promise<HtmlEscapedString>;

// Only the active tab is queried and rendered, so this is a union keyed
// on `tab` rather than one field per table.
export type TabContent =
  | { tab: "packages"; page: Page<PackageRow> }
  | { tab: "pull-requests"; page: Page<PullRequestRow> };

export interface RepoView {
  state: DashboardState;
  summary: RepoSummary;
  content: TabContent;
}

// The stylesheet is served without cache headers, so browsers keep
// reusing a stale copy after it changes. A content hash in its URL makes
// every change a new URL.
const STYLE_VERSION = createHash("sha256")
  .update(readFileSync(join(import.meta.dirname, "static", "style.css")))
  .digest("hex")
  .slice(0, 8);

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

// Stored timestamps are SQLite's "YYYY-MM-DD HH:MM:SS" (UTC). The date is
// what matters at a glance; the full timestamp stays on hover.
function date(timestamp: string): Fragment {
  return html`<time datetime="${timestamp}" title="${timestamp} UTC"
    >${timestamp.slice(0, 10)}</time
  >`;
}

// ---------------------------------------------------------------------------
// URLs. Every link is a full navigation carrying the whole state in the
// query string, same as the search form - no client-side state.

type Query = Partial<Record<keyof DashboardState, string | number | undefined>>;

function href(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/?${search}` : "/";
}

function stateQuery(state: DashboardState): Query {
  return {
    repo: state.repo,
    tab: state.tab,
    q: state.q,
    page: state.page > 1 ? state.page : undefined,
  };
}

// Switching tabs keeps the repo and drops the search and page, which only
// mean something on the tab being left.
function tabHref(state: DashboardState, tab: Tab): string {
  return href({ repo: state.repo, tab });
}

// ---------------------------------------------------------------------------
// Shared pieces

// "https://github.com/o/r/pull/12" -> "#12"; anything else is shown as-is.
function prLabel(url: string): string {
  const number = /\/pull\/(\d+)\/?$/.exec(url)?.[1];
  return number ? `#${number}` : url;
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

function empty(message: Fragment | string): Fragment {
  return html`<p class="empty">${message}</p>`;
}

// ---------------------------------------------------------------------------
// Page shell: top bar with the brand and, inside a repo, its name

function layout(title: string, crumb: string | undefined, body: Fragment): Fragment {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <link rel="icon" href="/logo-mark.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
        />
        <link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}" />
      </head>
      <body>
        <header class="topbar">
          <div class="shell topbar-inner">
            <a class="brand" href="/" aria-label="APIWeiser - all repositories">
              <img src="/logo-mark.png" alt="" class="brand-mark" />
              <span class="brand-name">API<span>Weiser</span></span>
            </a>
            ${
              crumb
                ? html`<span class="crumb-sep">/</span> <span class="crumb">${crumb}</span>`
                : ""
            }
          </div>
        </header>

        <main class="shell">${body}</main>

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

// ---------------------------------------------------------------------------
// Repo list - the landing page

export function reposPage(repos: RepoSummary[]): Fragment {
  const table =
    repos.length === 0
      ? empty(
          html`No repositories scanned yet. Run
            <code>apiweiser-cli scan --path &lt;repo&gt;</code>.`,
        )
      : html`<table>
          <thead>
            <tr>
              <th>Repository</th>
              <th class="num">Dependencies</th>
              <th class="num">PRs</th>
            </tr>
          </thead>
          <tbody>
            ${repos.map(
              (r) =>
                html`<tr>
                  <td class="repo-cell">
                    <a class="repo-link" href="${href({ repo: r.repoPath })}">
                      <strong>${basename(r.repoPath)}</strong>
                      <span class="repo-full-path">${r.repoPath}</span>
                    </a>
                  </td>
                  <td class="num">${fmt(r.dependencies)}</td>
                  <td class="num">${fmt(r.pullRequests)}</td>
                </tr>`,
            )}
          </tbody>
        </table>`;

  return layout(
    "APIWeiser",
    undefined,
    html`<div class="page-heading">
        <div>
          <h1>Repositories</h1>
          <p>Every repository apiweiser-cli has scanned.</p>
        </div>
      </div>
      <section class="panel">
        <div class="table-wrap">${table}</div>
      </section>`,
  );
}

// ---------------------------------------------------------------------------
// One repo: its dependencies and the PRs opened for it

const TAB_HEADINGS: Record<Tab, { title: string; description: string }> = {
  packages: {
    title: "Dependencies",
    description: "The direct dependencies this repository declares.",
  },
  "pull-requests": {
    title: "Pull requests",
    description: "Migration PRs opened for this repository, newest first.",
  },
};

// Each metric *is* a tab, so each number is also the way in.
function summaryCards(state: DashboardState, summary: RepoSummary): Fragment {
  const card = (tab: Tab, value: number, label: string, detail: string) =>
    html`<a
      class="metric"
      href="${tabHref(state, tab)}"
      aria-current="${state.tab === tab ? "page" : "false"}"
    >
      <span class="metric-label">${label}</span>
      <strong>${fmt(value)}</strong>
      <span class="metric-detail">${detail}</span>
    </a>`;

  return html`<nav class="metrics" aria-label="Sections">
    ${card("packages", summary.dependencies, "Dependencies", "direct")}
    ${card("pull-requests", summary.pullRequests, "Pull requests", "migrations opened")}
  </nav>`;
}

function toolbar(state: DashboardState): Fragment {
  const placeholder = "Search dependencies…";
  return html`<div class="toolbar">
    <form class="search" method="get" action="/" role="search">
      <input type="hidden" name="repo" value="${state.repo}" />
      <input type="hidden" name="tab" value="${state.tab}" />
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
    </form>
  </div>`;
}

function packagesPanel(state: DashboardState, page: Page<PackageRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(
      state.q
        ? html`No dependencies match “${state.q}”.`
        : "No direct dependencies recorded for this repository.",
    );
  }

  return html`<table>
    <thead>
      <tr>
        <th>Package</th>
        <th>Version</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (r) =>
          html`<tr>
            <td><strong>${r.name}</strong></td>
            <td><code>${r.currentVersion}</code></td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function pullRequestsPanel(state: DashboardState, page: Page<PullRequestRow>): Fragment {
  if (page.rows.length === 0) {
    return empty(
      state.q ? html`No PRs for dependencies matching “${state.q}”.` : "No PRs opened yet.",
    );
  }

  return html`<table>
    <thead>
      <tr>
        <th>PR</th>
        <th>Packages</th>
        <th>Opened</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (pr) =>
          html`<tr>
            <td>
              <a class="pr-link" href="${pr.url}" target="_blank" rel="noopener" title="${pr.url}"
                >${prLabel(pr.url)} ↗</a
              >
            </td>
            <td>
              <ul class="pr-packages">
                ${pr.packages.map(
                  (p) =>
                    html`<li>
                      <strong>${p.name}</strong> <code>${p.version} → ${p.newVersion}</code>
                    </li>`,
                )}
              </ul>
            </td>
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
    case "pull-requests":
      return pullRequestsPanel(state, content.page);
  }
}

export function repoPage({ state, summary, content }: RepoView): Fragment {
  const name = basename(summary.repoPath);
  const { title, description } = TAB_HEADINGS[state.tab];

  return layout(
    `${name} · APIWeiser`,
    name,
    html`<div class="page-heading">
        <div>
          <a class="back" href="/">← All repositories</a>
          <h1>${title}</h1>
          <p>${description}</p>
        </div>
        <code class="repo-path" title="${summary.repoPath}">${summary.repoPath}</code>
      </div>
      ${summaryCards(state, summary)}
      <section class="panel">
        ${toolbar(state)}
        <div class="table-wrap">${panel(state, content)}</div>
        ${paginationControls(state, content.page)}
      </section>`,
  );
}
