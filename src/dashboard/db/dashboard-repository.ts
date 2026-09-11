// Read-only queries for the dashboard. Deliberately its own repository
// rather than bolted onto PackagesRepository/SuggestionsRepository/
// PullRequestsRepository - those are shaped around what each module needs
// to write; this one joins across tables for what a human wants to look
// at, and has no writes at all.

import type { Database } from "../../db/database.ts";
import type { Page, PackageRow, PullRequestRow, SuggestionRow } from "../types.ts";

export const PAGE_SIZE = 20;

export class DashboardRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  listPackages(page: number): Page<PackageRow> {
    return this.paginate<PackageRow>(
      "packages",
      `SELECT repo_path AS repoPath, name, current_version AS currentVersion, type
       FROM packages
       ORDER BY repo_path, name
       LIMIT ? OFFSET ?`,
      page,
    );
  }

  listSuggestions(page: number): Page<SuggestionRow> {
    return this.paginate<SuggestionRow>(
      "suggestions",
      `SELECT repo_path AS repoPath, dependency, current_version AS currentVersion,
              new_version AS newVersion, update_type AS updateType, scanned_at AS scannedAt
       FROM suggestions
       ORDER BY scanned_at DESC
       LIMIT ? OFFSET ?`,
      page,
    );
  }

  listPullRequests(page: number): Page<PullRequestRow> {
    return this.paginate<PullRequestRow>(
      "pull_requests",
      `SELECT repo_path AS repoPath, package_name AS packageName, version,
              new_version AS newVersion, url, opened_at AS openedAt
       FROM pull_requests
       ORDER BY opened_at DESC
       LIMIT ? OFFSET ?`,
      page,
    );
  }

  // Shared by all three lists above - same shape (a plain table, no
  // filters), just a different query. `page` is 1-based and clamped to at
  // least 1 by the caller (server.ts); a page past the end just comes back
  // with an empty `rows`, same as SQLite's own OFFSET behavior.
  private paginate<T>(table: string, query: string, page: number): Page<T> {
    const { count } = this.db.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    const rows = this.db.connection
      .prepare(query)
      .all(PAGE_SIZE, (page - 1) * PAGE_SIZE) as unknown as T[];
    return { rows, page, totalPages, total: count };
  }
}
