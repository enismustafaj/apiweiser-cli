// Persists where to fetch a package's changelog from. Keyed by package_id
// directly (from Dependency.id, set by PackagesRepository.upsert()) -
// callers already have it, no need to look it up again by name here.

import type { Database } from "../../db/database.ts";
import type { DataSourceEntry } from "../types.ts";

export class DataSourcesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(sources: Map<number, string>): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO data_sources (package_id, url) VALUES (?, ?)`,
    );
    for (const [packageId, url] of sources) {
      insert.run(packageId, url);
    }
  }

  // Every known data source - what ReleaseAnalysisModule walks each run.
  listAll(): DataSourceEntry[] {
    return this.db.connection
      .prepare(`SELECT package_id AS packageId, url FROM data_sources`)
      .all() as unknown as DataSourceEntry[];
  }
}
