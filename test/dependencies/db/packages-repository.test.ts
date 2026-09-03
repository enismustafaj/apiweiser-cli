import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";

function commander(currentVersion: string): Dependency {
  return { name: "commander", currentVersion, type: "direct" };
}

test("findChangedOrNew treats an unseen dependency as new", () => {
  const repo = new PackagesRepository(new Database(":memory:"));

  const result = repo.findChangedOrNew([commander("15.0.0")]);

  assert.deepEqual(result, [commander("15.0.0")]);
});

test("findChangedOrNew skips a dependency whose version hasn't changed", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert([commander("15.0.0")]);

  const result = repo.findChangedOrNew([commander("15.0.0")]);

  assert.deepEqual(result, []);
});

test("findChangedOrNew includes a dependency whose version changed", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert([commander("15.0.0")]);

  const result = repo.findChangedOrNew([commander("16.0.0")]);

  assert.deepEqual(result, [commander("16.0.0")]);
});

test("upsert updates the existing row instead of adding a new one", () => {
  const db = new Database(":memory:");
  const repo = new PackagesRepository(db);
  repo.upsert([commander("15.0.0")]);

  repo.upsert([commander("16.0.0")]);

  const rows = db.connection.prepare("SELECT * FROM packages").all();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { current_version: string }).current_version, "16.0.0");
});
