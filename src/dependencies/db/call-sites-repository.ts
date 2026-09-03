// Persists CallSites found by Scanner into the call_sites table, using an
// injected db connection (the shared singleton in normal use).

import type { Database } from "../../db/database.ts";
import type { CallSite } from "../types.ts";

export class CallSitesRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(callSites: CallSite[]): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO call_sites (dependency, file, line, snippet, api_surface)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const site of callSites) {
      insert.run(site.dependency, site.file, site.line, site.snippet, site.apiSurface);
    }
  }
}
