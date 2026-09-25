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

  listAll(): DataSourceEntry[] {
    return this.db.connection
      .prepare(`SELECT package_id AS packageId, url FROM data_sources`)
      .all() as unknown as DataSourceEntry[];
  }

  // By package name, not id - a changelog source is a property of the
  // package itself, not of whichever repo's scan happened to discover it
  // first (same reasoning as PackagesRepository.findNew).
  findUrl(packageName: string): string | null {
    const row = this.db.connection
      .prepare(
        `SELECT ds.url FROM data_sources ds
         JOIN packages p ON p.id = ds.package_id
         WHERE p.name = ?
         LIMIT 1`,
      )
      .get(packageName) as { url: string } | undefined;
    return row?.url ?? null;
  }
}
