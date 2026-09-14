import type { Database } from "../../db/database.ts";
import type { Dependency } from "../types.ts";

export class PackagesRepository {
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

  // Deliberately *not* scoped to repoPath, unlike findChangedOrNew above -
  // "new" means new to this CLI globally, since a package's changelog
  // source doesn't depend on which repo introduced it.
  findNew(dependencies: Dependency[]): Dependency[] {
    const exists = this.db.connection.prepare(`SELECT 1 FROM packages WHERE name = ?`);
    return dependencies.filter((dependency) => !exists.get(dependency.name));
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
}
