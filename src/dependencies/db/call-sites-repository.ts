// Persists CallSites found by Scanner into the call_sites table, using an
// injected db connection (the shared singleton in normal use).
//
// Each call site references its package by id, not name - PackagesRepository
// must have upserted the dependency first (DependenciesModule does this
// before scanning), or the package_id subquery below resolves to NULL and
// the insert fails the NOT NULL/foreign key constraint.

import type { Database } from "../../db/database.ts";
import type { CallSite } from "../types.ts";

export class CallSitesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(callSites: CallSite[]): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO call_sites (package_id, file, line, snippet, api_surface)
       VALUES ((SELECT id FROM packages WHERE name = ?), ?, ?, ?, ?)`,
    );
    for (const site of callSites) {
      insert.run(site.dependency, site.file, site.line, site.snippet, site.apiSurface);
    }
  }

  // Clears out previously-stored call sites for these dependencies before a
  // re-scan inserts fresh ones, so re-scanning a changed package doesn't
  // just pile up stale duplicates next to the new rows.
  deleteForDependencies(names: string[]): void {
    if (names.length === 0) return;

    const placeholders = names.map(() => "?").join(", ");
    this.db.connection
      .prepare(
        `DELETE FROM call_sites
         WHERE package_id IN (SELECT id FROM packages WHERE name IN (${placeholders}))`,
      )
      .run(...names);
  }
}
