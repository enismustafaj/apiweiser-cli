import type { Database } from "../../db/database.ts";
import type { Dependency } from "../types.ts";

export class PackagesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Scoped to repoPath - the same package name can be at a different
  // version in a different repo, and that's not a "change" for this repo.
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

  // Deliberately *not* scoped to repoPath - "new" here means new to this
  // CLI globally, across every repo it's ever scanned, not new to this one
  // repo. A package's changelog source (see DataSourcesModule) is a
  // property of the package, not of whichever repo happens to depend on
  // it, so a second repo introducing an already-known package shouldn't
  // re-trigger that lookup.
  findNew(dependencies: Dependency[]): Dependency[] {
    const exists = this.db.connection.prepare(`SELECT 1 FROM packages WHERE name = ?`);
    return dependencies.filter((dependency) => !exists.get(dependency.name));
  }

  // One row per (repoPath, package name): re-scanning the same repo updates
  // the existing row's version/type rather than growing the table, since a
  // package's current_version/type is that repo's current state, not a
  // scan-history event. A different repo with the same package name gets
  // its own row (see the `packages` table's UNIQUE(repo_path, name)).
  //
  // RETURNING id sets dependency.id in the same statement, so downstream
  // repositories (call sites, data sources) can insert with that id
  // directly instead of re-selecting it by name.
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
