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
    // One row per (repo_path, name) - not per name alone. Two repos can
    // depend on the same package at different versions; a single global
    // row would have the second scan silently overwrite the first repo's
    // version (and, via call_sites' package_id FK, its call sites too).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_path TEXT NOT NULL,
        name TEXT NOT NULL,
        current_version TEXT NOT NULL,
        type TEXT NOT NULL,
        UNIQUE(repo_path, name)
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
        repo_path TEXT NOT NULL,
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

    // One row per attempt, not per successful PR - "the agent tried and
    // failed" and "the codemod applied but changed nothing" are both
    // answers someone asks for later ("why is there no PR for chalk?"),
    // and both used to exist only as console output on a process that has
    // since been restarted.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS change_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_path TEXT NOT NULL,
        package_name TEXT NOT NULL,
        from_version TEXT NOT NULL,
        to_version TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        codemod_path TEXT,
        pr_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
