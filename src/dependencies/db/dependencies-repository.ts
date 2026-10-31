// The `packages` table and the `call_sites` that hang off it. Every
// call-site method is scoped to repoPath - `packages` has one row per
// (repoPath, name), so resolving package_id by name alone could match a
// different repo's row for the same package name. A package must be
// upserted before its call sites are inserted, or the package_id subquery
// resolves to NULL and violates the FK constraint.

import type { Database } from "../../db/database.ts";
import type { CallSite, Dependency } from "../types.ts";

export class DependenciesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Scoped to repoPath - the same package can be at a different version in
  // a different repo, and that's not a "change" for this repo.
  findChangedOrNew(repoPath: string, dependencies: Dependency[]): Dependency[] {
    const getExisting = this.db.connection.prepare(
      `SELECT current_version FROM packages WHERE repo_path = ? AND name = ?`,
    );

    return dependencies.filter((dependency) => {
      const existing = getExisting.get(repoPath, dependency.name) as
        { current_version: string } | undefined;
      return !existing || existing.current_version !== dependency.currentVersion;
    });
  }

  findVersion(repoPath: string, name: string): string | null {
    const row = this.db.connection
      .prepare(`SELECT current_version FROM packages WHERE repo_path = ? AND name = ?`)
      .get(repoPath, name) as { current_version: string } | undefined;
    return row?.current_version ?? null;
  }

  find(repoPath: string, name: string): { id: number; currentVersion: string } | null {
    const row = this.db.connection
      .prepare(
        `SELECT id, current_version AS currentVersion FROM packages
         WHERE repo_path = ? AND name = ?`,
      )
      .get(repoPath, name) as { id: number; currentVersion: string } | undefined;
    return row ?? null;
  }

  findDirect(repoPath: string): { name: string; currentVersion: string }[] {
    return this.db.connection
      .prepare(
        `SELECT name, current_version AS currentVersion FROM packages
         WHERE repo_path = ? AND type = 'direct'`,
      )
      .all(repoPath) as { name: string; currentVersion: string }[];
  }

  // RETURNING id sets dependency.id in the same statement, so downstream
  // repositories can insert with that id directly instead of re-selecting
  // it by name.
  upsert(repoPath: string, dependencies: Dependency[]): void {
    const upsert = this.db.connection.prepare(
      `INSERT INTO packages (repo_path, name, current_version, type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(repo_path, name) DO UPDATE SET
         current_version = excluded.current_version,
         type = excluded.type
       RETURNING id`,
    );
    for (const dependency of dependencies) {
      const row = upsert.get(
        repoPath,
        dependency.name,
        dependency.currentVersion,
        dependency.type,
      ) as { id: number };
      dependency.id = row.id;
    }
  }

  findCallSites(repoPath: string, name: string): CallSite[] {
    return this.db.connection
      .prepare(
        `SELECT p.name AS dependency, cs.file, cs.line, cs.snippet, cs.api_surface AS apiSurface
         FROM call_sites cs
         JOIN packages p ON p.id = cs.package_id
         WHERE p.repo_path = ? AND p.name = ?`,
      )
      .all(repoPath, name) as unknown as CallSite[];
  }

  findCallSitesForRepo(repoPath: string): CallSite[] {
    return this.db.connection
      .prepare(
        `SELECT p.name AS dependency, cs.file, cs.line, cs.snippet, cs.api_surface AS apiSurface
         FROM call_sites cs
         JOIN packages p ON p.id = cs.package_id
         WHERE p.repo_path = ?
         ORDER BY p.name, cs.file, cs.line`,
      )
      .all(repoPath) as unknown as CallSite[];
  }

  insertCallSites(repoPath: string, callSites: CallSite[]): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO call_sites (package_id, file, line, snippet, api_surface)
       VALUES ((SELECT id FROM packages WHERE repo_path = ? AND name = ?), ?, ?, ?, ?)`,
    );
    for (const site of callSites) {
      insert.run(repoPath, site.dependency, site.file, site.line, site.snippet, site.apiSurface);
    }
  }

  deleteCallSites(repoPath: string, names: string[]): void {
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
