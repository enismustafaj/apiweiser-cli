// Persists RenovateUpdates found by RenovateTool into the suggestions
// table, using an injected db connection (the shared singleton in normal
// use).

import type { Database } from "../../db/database.ts";
import type { RenovateUpdate } from "../types.ts";

export class SuggestionsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(repoPath: string, updates: RenovateUpdate[]): void {
    const insert = this.db.connection.prepare(
      `INSERT INTO suggestions
         (repo_path, dependency, package_file, dep_type, current_version, new_version, update_type, datasource, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const update of updates) {
      insert.run(
        repoPath,
        update.dependency,
        update.packageFile,
        update.depType,
        update.currentVersion,
        update.newVersion,
        update.updateType,
        update.datasource,
        update.sourceUrl ?? null,
      );
    }
  }
}
