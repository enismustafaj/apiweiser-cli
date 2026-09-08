// Persists the outcome of every change-request attempt (see
// ChangeRequestsModule) into the change_requests table, using an injected
// db connection (the shared singleton in normal use).

import type { Database } from "../../db/database.ts";
import type { ChangeRequestRecord, ChangeRequestStatus } from "../types.ts";

export class ChangeRequestsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  insert(record: ChangeRequestRecord): void {
    this.db.connection
      .prepare(
        `INSERT INTO change_requests
           (repo_path, package_name, from_version, to_version, summary, status, detail, codemod_path, pr_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.repoPath,
        record.packageName,
        record.fromVersion,
        record.toVersion,
        record.summary,
        record.status,
        record.detail ?? null,
        record.codemodPath ?? null,
        record.prUrl ?? null,
      );
  }

  findAll(
    filter: { status?: ChangeRequestStatus; packageName?: string } = {},
  ): ChangeRequestRecord[] {
    const rows = this.db.connection
      .prepare(
        `SELECT repo_path AS repoPath, package_name AS packageName, from_version AS fromVersion,
                to_version AS toVersion, summary, status, detail, codemod_path AS codemodPath,
                pr_url AS prUrl, created_at AS createdAt
         FROM change_requests
         WHERE (? IS NULL OR status = ?)
           AND (? IS NULL OR package_name = ?)
         ORDER BY created_at DESC, id DESC`,
      )
      .all(
        filter.status ?? null,
        filter.status ?? null,
        filter.packageName ?? null,
        filter.packageName ?? null,
      ) as unknown as ChangeRequestRecord[];
    return rows;
  }
}
