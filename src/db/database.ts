// Wraps the CLI's sqlite database, used to persist scan results (call
// sites). Stored in a directory dedicated to this CLI
// (~/.apiweiser-scanner), separate from whatever repo is being scanned.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = join(homedir(), ".apiweiser-scanner", "db.sqlite");

export class Database {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  // No migration framework here (yet) - schema changes are additive
  // CREATE TABLE IF NOT EXISTS statements. If you change an existing
  // table's columns, delete ~/.apiweiser-scanner/db.sqlite and let it
  // recreate; there's no ALTER TABLE step.
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        current_version TEXT NOT NULL,
        type TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS call_sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id INTEGER NOT NULL REFERENCES packages(id),
        file TEXT NOT NULL,
        line INTEGER NOT NULL,
        snippet TEXT NOT NULL,
        api_surface TEXT NOT NULL,
        scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dependency TEXT NOT NULL,
        package_file TEXT NOT NULL,
        dep_type TEXT NOT NULL,
        current_version TEXT NOT NULL,
        new_version TEXT NOT NULL,
        update_type TEXT NOT NULL,
        datasource TEXT NOT NULL,
        source_url TEXT,
        scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Raw connection, for repositories to prepare/run their own queries on.
  get connection(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// Single shared connection to the CLI's sqlite db, so modules don't each
// open their own handle to the same file.
export const db = new Database();

process.on("exit", () => db.close());
