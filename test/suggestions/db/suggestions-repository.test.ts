import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { SuggestionsRepository } from "../../../src/suggestions/db/suggestions-repository.ts";
import type { RenovateUpdate } from "../../../src/suggestions/types.ts";
import { plainRows } from "../../support/plain-rows.ts";

const REPO_A = "/repos/a";

function update(overrides: Partial<RenovateUpdate> = {}): RenovateUpdate {
  return {
    dependency: "commander",
    packageFile: "package.json",
    depType: "dependencies",
    currentVersion: "10.0.1",
    newVersion: "15.0.0",
    updateType: "major",
    datasource: "npm",
    sourceUrl: "https://github.com/tj/commander.js",
    ...overrides,
  };
}

test("insert stores every field, including a null source_url", () => {
  const db = new Database(":memory:");
  const repo = new SuggestionsRepository(db);

  repo.insert(REPO_A, [update(), update({ dependency: "ts-morph", sourceUrl: undefined })]);

  const rows = db.connection
    .prepare(
      "SELECT repo_path, dependency, new_version, source_url FROM suggestions ORDER BY dependency",
    )
    .all();
  assert.deepEqual(plainRows(rows), [
    {
      repo_path: REPO_A,
      dependency: "commander",
      new_version: "15.0.0",
      source_url: "https://github.com/tj/commander.js",
    },
    { repo_path: REPO_A, dependency: "ts-morph", new_version: "15.0.0", source_url: null },
  ]);
});

test("insert is a no-op for an empty list", () => {
  const db = new Database(":memory:");
  const repo = new SuggestionsRepository(db);

  repo.insert(REPO_A, []);

  const count = db.connection.prepare("SELECT COUNT(*) AS n FROM suggestions").get() as {
    n: number;
  };
  assert.equal(count.n, 0);
});
