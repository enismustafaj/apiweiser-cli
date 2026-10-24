import type { Database } from "../../db/database.ts";
import type { Page, PackageRow, PullRequestRow, RepoSummary } from "../types.ts";

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

export class DashboardRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // The repo list, or one repo's counts when `repo` is given. Every repo
  // any module has written a row for, not just ones with packages - a PR
  // can outlive a re-scan. A group PR is one row per package, so PRs are
  // counted by distinct URL.
  repoSummaries(repo?: string): RepoSummary[] {
    return this.db.connection
      .prepare(
        `WITH repos AS (
           SELECT repo_path FROM packages
           UNION SELECT repo_path FROM pull_requests
         )
         SELECT r.repo_path AS repoPath,
                (SELECT COUNT(*) FROM packages p
                 WHERE p.repo_path = r.repo_path AND p.type = 'direct') AS dependencies,
                (SELECT COUNT(DISTINCT url) FROM pull_requests pr
                 WHERE pr.repo_path = r.repo_path) AS pullRequests
         FROM repos r
         WHERE $repo IS NULL OR r.repo_path = $repo
         ORDER BY r.repo_path`,
      )
      .all({ repo: repo ?? null }) as unknown as RepoSummary[];
  }

  // Direct dependencies only - transitive ones aren't something the
  // pipeline acts on yet.
  listPackages(filter: Filter, page: number): Page<PackageRow> {
    const where = `WHERE type = 'direct'
                     AND ($repo IS NULL OR repo_path = $repo)
                     AND ($q IS NULL OR name LIKE $q ESCAPE '\\')`;
    return this.paginate<PackageRow>(
      `SELECT COUNT(*) AS count FROM packages ${where}`,
      `SELECT name, current_version AS currentVersion
       FROM packages
       ${where}
       ORDER BY name
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q) },
      page,
    );
  }

  // Newest first, one row per PR. Searching matches any package in the
  // PR, and still returns the whole PR.
  listPullRequests(filter: Filter, page: number): Page<PullRequestRow> {
    const where = `WHERE ($repo IS NULL OR repo_path = $repo)
                     AND ($q IS NULL OR url IN (SELECT url FROM pull_requests
                                                WHERE package_name LIKE $q ESCAPE '\\'))`;
    const result = this.paginate<Omit<PullRequestRow, "packages"> & { packages: string }>(
      `SELECT COUNT(DISTINCT url) AS count FROM pull_requests ${where}`,
      `SELECT url, MAX(opened_at) AS openedAt,
              json_group_array(json_object('name', package_name, 'version', version,
                                           'newVersion', new_version)) AS packages
       FROM pull_requests
       ${where}
       GROUP BY url
       ORDER BY openedAt DESC, MAX(id) DESC
       LIMIT $limit OFFSET $offset`,
      { repo: filter.repo ?? null, q: like(filter.q) },
      page,
    );
    return {
      ...result,
      rows: result.rows.map((row) => ({ ...row, packages: JSON.parse(row.packages) })),
    };
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
