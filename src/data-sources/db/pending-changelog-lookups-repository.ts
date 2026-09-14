import type { Database } from "../../db/database.ts";
import type { Dependency } from "../../dependencies/types.ts";
import type { PendingLookup } from "../types.ts";

export class PendingChangelogLookupsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // UNIQUE(package_id): an already-queued package doesn't get a duplicate row.
  enqueue(dependencies: Dependency[]): void {
    const insert = this.db.connection.prepare(
      `INSERT OR IGNORE INTO pending_changelog_lookups (package_id) VALUES (?)`,
    );
    for (const dependency of dependencies) {
      if (dependency.id === undefined) continue;
      insert.run(dependency.id);
    }
  }

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
