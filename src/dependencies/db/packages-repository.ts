// Upserts scanned Dependencies into the packages table. call_sites
// references rows here by package_id instead of repeating the dependency
// name/version on every call site row.

import type { Database } from "../../db/database.ts";
import type { Dependency } from "../types.ts";

export class PackagesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Dependencies that either aren't in the packages table yet, or whose
  // current_version no longer matches what's stored - i.e. the ones worth
  // re-scanning for call sites. Unchanged dependencies are left out so
  // DependenciesModule can skip the expensive ts-morph scan for them.
  findChangedOrNew(dependencies: Dependency[]): Dependency[] {
    const getExisting = this.db.connection.prepare(
      `SELECT current_version FROM packages WHERE name = ?`,
    );

    return dependencies.filter((dependency) => {
      const existing = getExisting.get(dependency.name) as { current_version: string } | undefined;
      return !existing || existing.current_version !== dependency.currentVersion;
    });
  }

  // One row per package name: re-scanning updates the existing row's
  // version/type rather than growing the table, since a package's
  // current_version/type is current state, not a scan-history event.
  upsert(dependencies: Dependency[]): void {
    const upsert = this.db.connection.prepare(
      `INSERT INTO packages (name, current_version, type)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         current_version = excluded.current_version,
         type = excluded.type`,
    );
    for (const dependency of dependencies) {
      upsert.run(dependency.name, dependency.currentVersion, dependency.type);
    }
  }
}
