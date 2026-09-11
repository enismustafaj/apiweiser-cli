import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Page, PackageRow, PullRequestRow, SuggestionRow, Tab } from "./types.ts";

function updateTypeBadge(updateType: string): HtmlEscapedString | Promise<HtmlEscapedString> {
  const known = new Set(["major", "minor", "patch"]);
  const cls = known.has(updateType) ? `badge-${updateType}` : "badge-default";
  return html`<span class="badge ${cls}">${updateType}</span>`;
}

function paginationControls(
  tab: Tab,
  page: Page<unknown>,
  buildHref: (page: number) => string,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (page.totalPages <= 1) return html``;
  return html`<nav class="pagination" aria-label="${tab} pages">
    ${
      page.page > 1
        ? html`<a href="${buildHref(page.page - 1)}">← Prev</a>`
        : html`<span>← Prev</span>`
    }
    <span>Page ${page.page} of ${page.totalPages}</span>
    ${
      page.page < page.totalPages
        ? html`<a href="${buildHref(page.page + 1)}">Next →</a>`
        : html`<span>Next →</span>`
    }
  </nav>`;
}

function packagesTable(page: Page<PackageRow>): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (page.rows.length === 0) return html`<p class="empty">No packages scanned yet.</p>`;
  return html`<table>
    <thead>
      <tr>
        <th>Repo</th>
        <th>Package</th>
        <th>Version</th>
        <th>Type</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (r) =>
          html`<tr>
            <td>${r.repoPath}</td>
            <td><strong>${r.name}</strong></td>
            <td><code>${r.currentVersion}</code></td>
            <td>${r.type}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function suggestionsTable(
  page: Page<SuggestionRow>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (page.rows.length === 0) return html`<p class="empty">No suggestions yet.</p>`;
  return html`<table>
    <thead>
      <tr>
        <th>Repo</th>
        <th>Dependency</th>
        <th>Current</th>
        <th>New</th>
        <th>Update</th>
        <th>Found</th>
      </tr>
    </thead>
    <tbody>
      ${page.rows.map(
        (s) =>
          html`<tr>
            <td>${s.repoPath}</td>
            <td><strong>${s.dependency}</strong></td>
            <td><code>${s.currentVersion}</code></td>
            <td><code>${s.newVersion}</code></td>
            <td>${updateTypeBadge(s.updateType)}</td>
            <td>${s.scannedAt}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

function pullRequestsTable(
  page: Page<PullRequestRow>,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  if (page.rows.length === 0) return html`<p class="empty">No PRs opened yet.</p>`;
  return html`<table>
    <thead>
      <tr>
        <th>Repo</th>
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
            <td>${pr.repoPath}</td>
            <td><strong>${pr.packageName}</strong></td>
            <td><code>${pr.version} → ${pr.newVersion}</code></td>
            <td><a href="${pr.url}" target="_blank" rel="noopener">View PR ↗</a></td>
            <td>${pr.openedAt}</td>
          </tr>`,
      )}
    </tbody>
  </table>`;
}

export function dashboardPage(
  packages: Page<PackageRow>,
  suggestions: Page<SuggestionRow>,
  pullRequests: Page<PullRequestRow>,
  activeTab: Tab,
): HtmlEscapedString | Promise<HtmlEscapedString> {
  const hrefFor = (
    tab: Tab,
    packagesPage: number,
    suggestionsPage: number,
    pullRequestsPage: number,
  ) =>
    `/?tab=${tab}&packagesPage=${packagesPage}&suggestionsPage=${suggestionsPage}&pullRequestsPage=${pullRequestsPage}`;

  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>apiweiser-cli</title>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header class="container">
          <hgroup class="brand">
            <img src="/logo.png" alt="APIWeiser" class="brand-logo" />
            <p>Dependency watchtower — packages, suggestions, and PRs, live from the local db.</p>
          </hgroup>
        </header>

        <main class="container">
          <section class="stats-grid" aria-label="Summary">
            <article><strong>${packages.total}</strong><span>packages tracked</span></article>
            <article><strong>${suggestions.total}</strong><span>open suggestions</span></article>
            <article><strong>${pullRequests.total}</strong><span>PRs opened</span></article>
          </section>

          <div class="tabs">
            <input
              type="radio"
              name="tabs"
              id="tab-packages"
              class="tab-input"
              ${activeTab === "packages" ? "checked" : ""}
            />
            <input
              type="radio"
              name="tabs"
              id="tab-suggestions"
              class="tab-input"
              ${activeTab === "suggestions" ? "checked" : ""}
            />
            <input
              type="radio"
              name="tabs"
              id="tab-pull-requests"
              class="tab-input"
              ${activeTab === "pull-requests" ? "checked" : ""}
            />

            <nav class="tab-labels">
              <label for="tab-packages">Packages</label>
              <label for="tab-suggestions">Suggestions</label>
              <label for="tab-pull-requests">Pull requests</label>
            </nav>

            <section class="tab-panel" id="panel-packages">
              ${packagesTable(packages)}
              ${paginationControls("packages", packages, (p) =>
                hrefFor("packages", p, suggestions.page, pullRequests.page),
              )}
            </section>
            <section class="tab-panel" id="panel-suggestions">
              ${suggestionsTable(suggestions)}
              ${paginationControls("suggestions", suggestions, (p) =>
                hrefFor("suggestions", packages.page, p, pullRequests.page),
              )}
            </section>
            <section class="tab-panel" id="panel-pull-requests">
              ${pullRequestsTable(pullRequests)}
              ${paginationControls("pull-requests", pullRequests, (p) =>
                hrefFor("pull-requests", packages.page, suggestions.page, p),
              )}
            </section>
          </div>
        </main>

        <footer class="container">
          <small>Reading straight from <code>~/.apiweiser-cli/db.sqlite</code></small>
        </footer>
      </body>
    </html>`;
}
