import type { Database } from "../../db/database.ts";

export class ChangelogSourcesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(sources: Map<number, string>): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO changelog_sources (package_id, url) VALUES (?, ?)`,
    );
    for (const [packageId, url] of sources) {
      insert.run(packageId, url);
    }
  }

  // By package name, not id - a changelog source is a property of the
  // package itself, not of whichever repo's scan happened to discover it
  // first.
  findUrl(packageName: string): string | null {
    const row = this.db.connection
      .prepare(
        `SELECT ds.url FROM changelog_sources ds
         JOIN packages p ON p.id = ds.package_id
         WHERE p.name = ?
         LIMIT 1`,
      )
      .get(packageName) as { url: string } | undefined;
    return row?.url ?? null;
  }
}
