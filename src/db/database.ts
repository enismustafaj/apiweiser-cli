import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DEFAULT_DB_PATH = join(homedir(), ".apiweiser-cli", "db.sqlite");

export class Database {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

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
      CREATE TABLE IF NOT EXISTS data_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id INTEGER NOT NULL REFERENCES packages(id),
        url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_changelog_lookups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id INTEGER NOT NULL UNIQUE REFERENCES packages(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS release_analysis_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'running'
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS release_analysis_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES release_analysis_runs(id),
        package_id INTEGER NOT NULL REFERENCES packages(id),
        release_tag TEXT NOT NULL,
        is_breaking INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  get connection(): DatabaseSync {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
