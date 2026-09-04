import type { Database } from "../../db/database.ts";
import type { Dependency } from "../types.ts";

export class PackagesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  findChangedOrNew(dependencies: Dependency[]): Dependency[] {
    const getExisting = this.db.connection.prepare(
      `SELECT current_version FROM packages WHERE name = ?`,
    );

    return dependencies.filter((dependency) => {
      const existing = getExisting.get(dependency.name) as { current_version: string } | undefined;
      return !existing || existing.current_version !== dependency.currentVersion;
    });
  }

  findNew(dependencies: Dependency[]): Dependency[] {
    const exists = this.db.connection.prepare(`SELECT 1 FROM packages WHERE name = ?`);
    return dependencies.filter((dependency) => !exists.get(dependency.name));
  }

  // One row per package name: re-scanning updates the existing row's
  // version/type rather than growing the table, since a package's
  // current_version/type is current state, not a scan-history event.
  //
  // RETURNING id sets dependency.id in the same statement, so downstream
  // repositories (call sites, data sources) can insert with that id
  // directly instead of re-selecting it by name.
  upsert(dependencies: Dependency[]): void {
    const upsert = this.db.connection.prepare(
      `INSERT INTO packages (name, current_version, type)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         current_version = excluded.current_version,
         type = excluded.type
       RETURNING id`,
    );
    for (const dependency of dependencies) {
      const row = upsert.get(dependency.name, dependency.currentVersion, dependency.type) as {
        id: number;
      };
      dependency.id = row.id;
    }
  }
}
