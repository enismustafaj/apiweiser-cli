// Registers each ReleaseAnalysisModule run (when it started, ended, and
// its outcome) and the per-package results produced during it.

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
