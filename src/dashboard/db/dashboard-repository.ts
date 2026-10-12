import type { Database } from "../../db/database.ts";
import type {
  ApiSurfaceCount,
  CallSiteRow,
  CallSiteUsageRow,
  Page,
  PackageRow,
  PackageType,
  PullRequestRow,
  SuggestionRow,
  Summary,
} from "../types.ts";

export const PAGE_SIZE = 20;

// Every filter is optional; undefined means "don't filter on this". SQL
// spells that as `($x IS NULL OR col = $x)`, so each query is one fixed
// statement rather than a WHERE clause assembled from pieces.
export interface Filter {
  repo?: string;
  q?: string;
}

type Params = Record<string, string | number | null>;

// `q` is a substring search, so LIKE's own wildcards in it are escaped -
// searching for "foo_bar" shouldn't also match "fooXbar".
function like(q: string | undefined): string | null {
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// Per-package call-site counts, joined in rather than counted with a
// correlated subquery - call_sites has no index on package_id, and a real
// scan (got) has 10.7k rows, so a per-row COUNT(*) gets slow fast.
const CALL_SITE_COUNTS = `(SELECT package_id, COUNT(*) AS n FROM call_sites GROUP BY package_id)`;

export class DashboardRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Every repo any module has written a row for, not just ones with
  // packages - a suggestion or PR can outlive a re-scan.
  listRepos(): string[] {
    return (
      this.db.connection
        .prepare(
          `SELECT repo_path AS repoPath FROM packages
           UNION SELECT repo_path FROM suggestions
           UNION SELECT repo_path FROM pull_requests
           ORDER BY repoPath`,
        )
        .all() as unknown as { repoPath: string }[]
    ).map((row) => row.repoPath);
  }

  summary(repo: string | undefined): Summary {
    return this.db.connection
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM packages
            WHERE type = 'direct' AND ($repo IS NULL OR repo_path = $repo)) AS direct,
           (SELECT COUNT(*) FROM packages
            WHERE type = 'transitive' AND ($repo IS NULL OR repo_path = $repo)) AS transitive,
           (SELECT COUNT(*) FROM call_sites c JOIN packages p ON p.id = c.package_id
            WHERE $repo IS NULL OR p.repo_path = $repo) AS callSites,
           (SELECT COUNT(DISTINCT c.package_id) FROM call_sites c JOIN packages p ON p.id = c.package_id
            WHERE $repo IS NULL OR p.repo_path = $repo) AS packagesWithCallSites,
           (SELECT COUNT(*) FROM suggestions
            WHERE $repo IS NULL OR repo_path = $repo) AS suggestions,
           (SELECT COUNT(*) FROM pull_requests
            WHERE $repo IS NULL OR repo_path = $repo) AS pullRequests`,
      )
      .get({ repo: repo ?? null }) as unknown as Summary;
  }

  // How many packages of each type match the repo + search, ignoring the
  // type filter itself - these label the Direct/Transitive/All toggle.
  packageTypeCounts(filter: Filter): Record<PackageType, number> {
    const rows = this.db.connection
      .prepare(
        `SELECT type, COUNT(*) AS n FROM packages
         WHERE ($repo IS NULL OR repo_path = $repo)
           AND ($q IS NULL OR name LIKE $q ESCAPE '\\')
         GROUP BY type`,
      )
      .all({ repo: filter.repo ?? null, q: like(filter.q) }) as unknown as {
      type: string;
      n: number;
    }[];
    const counts = { direct: 0, transitive: 0 };
    for (const row of rows) {
      if (row.type === "direct" || row.type === "transitive") counts[row.type] = row.n;
    }
    return counts;
  }

  // Direct dependencies first, then the most-used ones - what's actually
  // wired into the code matters more than alphabetical order.
  listPackages(filter: Filter & { type?: PackageType }, page: number): Page<PackageRow> {
    const where = `WHERE ($repo IS NULL OR p.repo_path = $repo)
                     AND ($q IS NULL OR p.name LIKE $q ESCAPE '\\')
                     AND ($type IS NULL OR p.type = $type)`;
    return this.paginate<PackageRow>(
      `SELECT COUNT(*) AS count FROM packages p ${where}`,
      `SELECT p.repo_path AS repoPath, p.name, p.current_version AS currentVersion, p.type,
              COALESCE(cs.n, 0) AS callSites
       FROM packages p
       LEFT JOIN ${CALL_SITE_COUNTS} cs ON cs.package_id = p.id
       ${where}
       ORDER BY p.type = 'direct' DESC, callSites DESC, p.name
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q), type: filter.type ?? null },
      page,
    );
  }

  // One row per package that has any call sites - the entry point into
  // the call-sites view before a package is picked.
  listCallSiteUsage(filter: Filter, page: number): Page<CallSiteUsageRow> {
    const where = `WHERE ($repo IS NULL OR p.repo_path = $repo)
                     AND ($q IS NULL OR p.name LIKE $q ESCAPE '\\')`;
    return this.paginate<CallSiteUsageRow>(
      `SELECT COUNT(DISTINCT p.id) AS count
       FROM call_sites c JOIN packages p ON p.id = c.package_id ${where}`,
      `SELECT p.repo_path AS repoPath, p.name AS packageName, p.type,
              COUNT(*) AS callSites, COUNT(DISTINCT c.file) AS files,
              COUNT(DISTINCT c.api_surface) AS apiSurfaces
       FROM call_sites c
       JOIN packages p ON p.id = c.package_id
       ${where}
       GROUP BY p.id
       ORDER BY callSites DESC, p.name
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q) },
      page,
    );
  }

  // `file` comes back relative to repo_path - stored absolute, it repeats
  // the (often very long) repo path on every row. REPLACE leaves a path
  // that somehow isn't under repo_path untouched rather than mangling it.
  listCallSites(
    filter: Filter & { packageName: string; api?: string },
    page: number,
  ): Page<CallSiteRow> {
    const where = `WHERE p.name = $packageName
                     AND ($repo IS NULL OR p.repo_path = $repo)
                     AND ($api IS NULL OR c.api_surface = $api)
                     AND ($q IS NULL OR c.file LIKE $q ESCAPE '\\' OR c.snippet LIKE $q ESCAPE '\\')`;
    return this.paginate<CallSiteRow>(
      `SELECT COUNT(*) AS count FROM call_sites c JOIN packages p ON p.id = c.package_id ${where}`,
      `SELECT p.repo_path AS repoPath, p.name AS packageName,
              REPLACE(c.file, p.repo_path || '/', '') AS file,
              c.line, c.snippet, c.api_surface AS apiSurface
       FROM call_sites c
       JOIN packages p ON p.id = c.package_id
       ${where}
       ORDER BY c.file, c.line
       LIMIT $limit OFFSET $offset`,
      {
        repo: filter.repo ?? null,
        q: like(filter.q),
        packageName: filter.packageName,
        api: filter.api ?? null,
      },
      page,
    );
  }

  // Which of a package's APIs the code leans on, most-used first - the
  // quickest read on how painful a breaking release would be.
  apiSurfaceCounts(repo: string | undefined, packageName: string): ApiSurfaceCount[] {
    return this.db.connection
      .prepare(
        `SELECT c.api_surface AS apiSurface, COUNT(*) AS count
         FROM call_sites c
         JOIN packages p ON p.id = c.package_id
         WHERE p.name = $packageName AND ($repo IS NULL OR p.repo_path = $repo)
         GROUP BY c.api_surface
         ORDER BY count DESC, apiSurface`,
      )
      .all({ repo: repo ?? null, packageName }) as unknown as ApiSurfaceCount[];
  }

  listSuggestions(filter: Filter, page: number): Page<SuggestionRow> {
    const where = `WHERE ($repo IS NULL OR repo_path = $repo)
                     AND ($q IS NULL OR dependency LIKE $q ESCAPE '\\')`;
    return this.paginate<SuggestionRow>(
      `SELECT COUNT(*) AS count FROM suggestions ${where}`,
      `SELECT repo_path AS repoPath, dependency, current_version AS currentVersion,
              new_version AS newVersion, update_type AS updateType, scanned_at AS scannedAt
       FROM suggestions
       ${where}
       ORDER BY scanned_at DESC, id DESC
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q) },
      page,
    );
  }

  listPullRequests(filter: Filter, page: number): Page<PullRequestRow> {
    const where = `WHERE ($repo IS NULL OR repo_path = $repo)
                     AND ($q IS NULL OR package_name LIKE $q ESCAPE '\\')`;
    return this.paginate<PullRequestRow>(
      `SELECT COUNT(*) AS count FROM pull_requests ${where}`,
      `SELECT repo_path AS repoPath, package_name AS packageName, version,
              new_version AS newVersion, url, opened_at AS openedAt
       FROM pull_requests
       ${where}
       ORDER BY opened_at DESC, id DESC
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q) },
      page,
    );
  }

  // `page` is 1-based, clamped to at least 1 by the caller (server.ts).
  // The count and the page are two plain queries sharing one WHERE clause
  // and one set of filter params.
  private paginate<T>(
    countQuery: string,
    rowsQuery: string,
    params: Params,
    page: number,
  ): Page<T> {
    const { count } = this.db.connection.prepare(countQuery).get(params) as { count: number };
    const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
    const rows = this.db.connection
      .prepare(rowsQuery)
      .all({ ...params, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }) as unknown as T[];
    return { rows, page, totalPages, total: count };
  }
}
