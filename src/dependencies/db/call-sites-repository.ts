// PackagesRepository must upsert the dependency before this runs, or the
// package_id subquery below resolves to NULL and violates the FK
// constraint. Every method is scoped to repoPath - `packages` has one row
// per (repoPath, name), so resolving package_id by name alone could match
// a different repo's row for the same package name.

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
