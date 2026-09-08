// Read-only queries backing the MCP server's tools (see docs/mcp.md).
// These live here rather than on the write-path repositories because
// nothing else in the CLI asks these questions - the scanners and
// schedulers only ever look up one package at a time, while every query
// here is a "show me everything that matches" report.

import type { Database } from "../../db/database.ts";
import type {
  BreakingChange,
  CallSiteRow,
  Overview,
  Suggestion,
  TrackedDependency,
} from "../types.ts";

export class InsightsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  listBreakingChanges(filter: { packageName?: string; limit: number }): BreakingChange[] {
    return this.db.connection
      .prepare(
        `SELECT p.name AS packageName, p.repo_path AS repoPath, r.release_tag AS releaseTag,
                r.summary, r.created_at AS detectedAt
         FROM release_analysis_results r
         JOIN packages p ON p.id = r.package_id
         WHERE r.is_breaking = 1
           AND (? IS NULL OR p.name = ?)
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`,
      )
      .all(
        filter.packageName ?? null,
        filter.packageName ?? null,
        filter.limit,
      ) as unknown as BreakingChange[];
  }

  listSuggestions(filter: {
    packageName?: string;
    updateType?: string;
    limit: number;
  }): Suggestion[] {
    return this.db.connection
      .prepare(
        `SELECT repo_path AS repoPath, dependency, package_file AS packageFile,
                dep_type AS depType, current_version AS currentVersion,
                new_version AS newVersion, update_type AS updateType, datasource,
                source_url AS sourceUrl, scanned_at AS scannedAt
         FROM suggestions
         WHERE (? IS NULL OR dependency = ?)
           AND (? IS NULL OR update_type = ?)
         ORDER BY scanned_at DESC, id DESC
         LIMIT ?`,
      )
      .all(
        filter.packageName ?? null,
        filter.packageName ?? null,
        filter.updateType ?? null,
        filter.updateType ?? null,
        filter.limit,
      ) as unknown as Suggestion[];
  }

  listDependencies(filter: { packageName?: string; limit: number }): TrackedDependency[] {
    return this.db.connection
      .prepare(
        `SELECT p.repo_path AS repoPath, p.name, p.current_version AS currentVersion, p.type,
                COUNT(c.id) AS callSiteCount
         FROM packages p
         LEFT JOIN call_sites c ON c.package_id = p.id
         WHERE (? IS NULL OR p.name = ?)
         GROUP BY p.id
         ORDER BY callSiteCount DESC, p.name ASC
         LIMIT ?`,
      )
      .all(
        filter.packageName ?? null,
        filter.packageName ?? null,
        filter.limit,
      ) as unknown as TrackedDependency[];
  }

  // repoPath is optional here, unlike CallSitesRepository.findForDependency,
  // because whoever is asking through the MCP knows a package name but
  // usually not which absolute path it was scanned under.
  //
  // `file` is returned relative to repo_path. Stored absolute, it repeats
  // the repo path on every row - on a real repo (got: 10.7k call sites)
  // that's kilobytes of duplicated prefix per response, which costs an LLM
  // client real context for no information. REPLACE leaves any path that
  // somehow isn't under repo_path untouched rather than mangling it.
  listCallSites(filter: { packageName: string; repoPath?: string; limit: number }): CallSiteRow[] {
    return this.db.connection
      .prepare(
        `SELECT p.repo_path AS repoPath, p.name AS dependency,
                REPLACE(c.file, p.repo_path || '/', '') AS file,
                c.line, c.snippet, c.api_surface AS apiSurface
         FROM call_sites c
         JOIN packages p ON p.id = c.package_id
         WHERE p.name = ?
           AND (? IS NULL OR p.repo_path = ?)
         ORDER BY c.file, c.line
         LIMIT ?`,
      )
      .all(
        filter.packageName,
        filter.repoPath ?? null,
        filter.repoPath ?? null,
        filter.limit,
      ) as unknown as CallSiteRow[];
  }

  overview(): Overview {
    const connection = this.db.connection;
    const count = (sql: string): number =>
      (connection.prepare(sql).get() as { n: number } | undefined)?.n ?? 0;

    const repos = (
      connection
        .prepare(`SELECT DISTINCT repo_path AS repoPath FROM packages ORDER BY repo_path`)
        .all() as unknown as { repoPath: string }[]
    ).map((row) => row.repoPath);

    const statusRows = connection
      .prepare(`SELECT status, COUNT(*) AS n FROM change_requests GROUP BY status`)
      .all() as unknown as { status: string; n: number }[];

    const lastRun =
      (connection
        .prepare(
          `SELECT started_at AS startedAt, ended_at AS endedAt, status
           FROM release_analysis_runs ORDER BY id DESC LIMIT 1`,
        )
        .get() as { startedAt: string; endedAt: string | null; status: string } | undefined) ??
      null;

    return {
      repos,
      dependencies: count(`SELECT COUNT(*) AS n FROM packages`),
      callSites: count(`SELECT COUNT(*) AS n FROM call_sites`),
      suggestions: count(`SELECT COUNT(*) AS n FROM suggestions`),
      breakingReleases: count(
        `SELECT COUNT(*) AS n FROM release_analysis_results WHERE is_breaking = 1`,
      ),
      changeRequestsByStatus: Object.fromEntries(statusRows.map((row) => [row.status, row.n])),
      lastReleaseAnalysis: lastRun,
    };
  }
}
