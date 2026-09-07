// Persists CallSites found by Scanner into the call_sites table, using an
// injected db connection (the shared singleton in normal use).
//
// Each call site references its package by id, not name - PackagesRepository
// must have upserted the dependency first (DependenciesModule does this
// before scanning), or the package_id subquery below resolves to NULL and
// the insert fails the NOT NULL/foreign key constraint. Every method here
// is scoped to a repoPath, since `packages` now has one row per
// (repoPath, name) - resolving package_id by name alone would risk
// matching a different repo's row for the same package name.

import type { Database } from "../../db/database.ts";
import type { CallSite } from "../types.ts";

export class CallSitesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  findForDependency(repoPath: string, name: string): CallSite[] {
    return this.db.connection
      .prepare(
        `SELECT p.name AS dependency, cs.file, cs.line, cs.snippet, cs.api_surface AS apiSurface
         FROM call_sites cs
         JOIN packages p ON p.id = cs.package_id
         WHERE p.repo_path = ? AND p.name = ?`,
      )
      .all(repoPath, name) as unknown as CallSite[];
  }

  insert(repoPath: string, callSites: CallSite[]): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO call_sites (package_id, file, line, snippet, api_surface)
       VALUES ((SELECT id FROM packages WHERE repo_path = ? AND name = ?), ?, ?, ?, ?)`,
    );
    for (const site of callSites) {
      insert.run(repoPath, site.dependency, site.file, site.line, site.snippet, site.apiSurface);
    }
  }

  // Clears out previously-stored call sites for these dependencies before a
  // re-scan inserts fresh ones, so re-scanning a changed package doesn't
  // just pile up stale duplicates next to the new rows.
  deleteForDependencies(repoPath: string, names: string[]): void {
    if (names.length === 0) return;

    const placeholders = names.map(() => "?").join(", ");
    this.db.connection
      .prepare(
        `DELETE FROM call_sites
         WHERE package_id IN (
           SELECT id FROM packages WHERE repo_path = ? AND name IN (${placeholders})
         )`,
      )
      .run(repoPath, ...names);
  }
}
