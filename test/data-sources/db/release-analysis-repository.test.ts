import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { ReleaseAnalysisRepository } from "../../../src/data-sources/db/release-analysis-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";

function setup() {
  const db = new Database(":memory:");
  const commander: Dependency = { name: "commander", currentVersion: "15.0.0", type: "direct" };
  new PackagesRepository(db).upsert("/repos/a", [commander]);
  return { releaseAnalysis: new ReleaseAnalysisRepository(db), db, commander };
}

test("startRun inserts a 'running' row and returns its id", () => {
  const { releaseAnalysis, db } = setup();

  const runId = releaseAnalysis.startRun();

  const row = db.connection
    .prepare("SELECT status, ended_at FROM release_analysis_runs WHERE id = ?")
    .get(runId) as { status: string; ended_at: string | null };
  assert.equal(row.status, "running");
  assert.equal(row.ended_at, null);
});

test("finishRun updates status and sets ended_at", () => {
  const { releaseAnalysis, db } = setup();
  const runId = releaseAnalysis.startRun();

  releaseAnalysis.finishRun(runId, "completed");

  const row = db.connection
    .prepare("SELECT status, ended_at FROM release_analysis_runs WHERE id = ?")
    .get(runId) as { status: string; ended_at: string | null };
  assert.equal(row.status, "completed");
  assert.notEqual(row.ended_at, null);
});

test("insertResult then findResult round-trips a breaking classification", () => {
  const { releaseAnalysis, commander } = setup();
  const runId = releaseAnalysis.startRun();

  releaseAnalysis.insertResult(runId, commander.id!, "v16.0.0", {
    isBreaking: true,
    summary: "removed the callback API",
  });

  const result = releaseAnalysis.findResult("commander", "16.0.0");
  assert.deepEqual(result, { isBreaking: true, summary: "removed the callback API" });
});

test("findResult matches a release_tag without the 'v' prefix too", () => {
  const { releaseAnalysis, commander } = setup();
  const runId = releaseAnalysis.startRun();
  releaseAnalysis.insertResult(runId, commander.id!, "16.0.0", {
    isBreaking: false,
    summary: "no breaking changes",
  });

  const result = releaseAnalysis.findResult("commander", "16.0.0");

  assert.deepEqual(result, { isBreaking: false, summary: "no breaking changes" });
});

test("findResult returns null when no result was recorded for that version", () => {
  const { releaseAnalysis } = setup();

  const result = releaseAnalysis.findResult("commander", "99.0.0");

  assert.equal(result, null);
});
