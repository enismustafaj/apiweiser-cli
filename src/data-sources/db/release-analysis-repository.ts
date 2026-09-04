import type { Database } from "../../db/database.ts";
import type { BreakingChangeClassification, ReleaseAnalysisRunStatus } from "../types.ts";

export class ReleaseAnalysisRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Starts as 'running'; RETURNING id so the caller can attach results to
  // this run without a separate lookup.
  startRun(): number {
    const row = this.db.connection
      .prepare(`INSERT INTO release_analysis_runs (status) VALUES ('running') RETURNING id`)
      .get() as { id: number };
    return row.id;
  }

  finishRun(runId: number, status: ReleaseAnalysisRunStatus): void {
    this.db.connection
      .prepare(
        `UPDATE release_analysis_runs SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(status, runId);
  }

  findResult(packageName: string, version: string): BreakingChangeClassification | null {
    const row = this.db.connection
      .prepare(
        `SELECT rar.is_breaking AS isBreaking, rar.summary
         FROM release_analysis_results rar
         JOIN packages p ON p.id = rar.package_id
         WHERE p.name = ? AND rar.release_tag IN (?, ?)
         ORDER BY rar.created_at DESC
         LIMIT 1`,
      )
      .get(packageName, version, `v${version}`) as
      { isBreaking: number; summary: string } | undefined;
    if (!row) return null;
    return { isBreaking: row.isBreaking === 1, summary: row.summary };
  }

  insertResult(
    runId: number,
    packageId: number,
    releaseTag: string,
    classification: BreakingChangeClassification,
  ): void {
    this.db.connection
      .prepare(
        `INSERT INTO release_analysis_results (run_id, package_id, release_tag, is_breaking, summary)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, packageId, releaseTag, classification.isBreaking ? 1 : 0, classification.summary);
  }
}
