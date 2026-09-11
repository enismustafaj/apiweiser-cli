// Read-only queries for the dashboard. Deliberately its own repository
// rather than bolted onto PackagesRepository/SuggestionsRepository/
// PullRequestsRepository - those are shaped around what each module needs
// to write; this one joins across tables for what a human wants to look
// at, and has no writes at all.

import type { Database } from "../../db/database.ts";

export interface PackageRow {
  repoPath: string;
  name: string;
  currentVersion: string;
  type: string;
}

export interface SuggestionRow {
  repoPath: string;
  dependency: string;
  currentVersion: string;
  newVersion: string;
  updateType: string;
  scannedAt: string;
}

export interface PullRequestRow {
  repoPath: string;
  packageName: string;
  version: string;
  newVersion: string;
  url: string;
  openedAt: string;
}

export class DashboardRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  listPackages(): PackageRow[] {
    return this.db.connection
      .prepare(
        `SELECT repo_path AS repoPath, name, current_version AS currentVersion, type
         FROM packages
         ORDER BY repo_path, name`,
      )
      .all() as unknown as PackageRow[];
  }

  listSuggestions(): SuggestionRow[] {
    return this.db.connection
      .prepare(
        `SELECT repo_path AS repoPath, dependency, current_version AS currentVersion,
                new_version AS newVersion, update_type AS updateType, scanned_at AS scannedAt
         FROM suggestions
         ORDER BY scanned_at DESC`,
      )
      .all() as unknown as SuggestionRow[];
  }

  listPullRequests(): PullRequestRow[] {
    return this.db.connection
      .prepare(
        `SELECT repo_path AS repoPath, package_name AS packageName, version,
                new_version AS newVersion, url, opened_at AS openedAt
         FROM pull_requests
         ORDER BY opened_at DESC`,
      )
      .all() as unknown as PullRequestRow[];
  }
}
