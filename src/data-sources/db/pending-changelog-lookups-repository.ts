// Queue of packages waiting for a changelog-source lookup. DataSourcesModule
// enqueues new packages here immediately (no network call), and drains it
// in rate-limit-sized batches on a schedule - see DataSourcesModule and
// docs/data-sources.md.

import type { Database } from "../../db/database.ts";
import type { Dependency } from "../../dependencies/types.ts";
import type { PendingLookup } from "../types.ts";

export class PendingChangelogLookupsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // UNIQUE(package_id) + INSERT OR IGNORE: a package already queued from an
  // earlier scan stays queued once, it doesn't duplicate.
  enqueue(dependencies: Dependency[]): void {
    const insert = this.db.connection.prepare(
      `INSERT OR IGNORE INTO pending_changelog_lookups (package_id) VALUES (?)`,
    );
    for (const dependency of dependencies) {
      if (dependency.id === undefined) continue;
      insert.run(dependency.id);
    }
  }

  // Oldest-queued first, capped at `limit` - the caller's per-tick budget
  // for however many registry requests it's willing to make.
  takeBatch(limit: number): PendingLookup[] {
    return this.db.connection
      .prepare(
        `SELECT pcl.id AS pendingId, p.id AS packageId, p.name AS packageName
         FROM pending_changelog_lookups pcl
         JOIN packages p ON p.id = pcl.package_id
         ORDER BY pcl.created_at
         LIMIT ?`,
      )
      .all(limit) as unknown as PendingLookup[];
  }

  remove(pendingId: number): void {
    this.db.connection.prepare(`DELETE FROM pending_changelog_lookups WHERE id = ?`).run(pendingId);
  }
}
