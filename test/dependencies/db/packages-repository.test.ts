import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";

const REPO_A = "/repos/a";
const REPO_B = "/repos/b";

function commander(currentVersion: string): Dependency {
  return { name: "commander", currentVersion, type: "direct" };
}

test("findChangedOrNew treats an unseen dependency as new", () => {
  const repo = new PackagesRepository(new Database(":memory:"));

  const result = repo.findChangedOrNew(REPO_A, [commander("15.0.0")]);

  assert.deepEqual(result, [commander("15.0.0")]);
});

test("findChangedOrNew skips a dependency whose version hasn't changed", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_A, [commander("15.0.0")]);

  assert.deepEqual(result, []);
});

test("findChangedOrNew includes a dependency whose version changed", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_A, [commander("16.0.0")]);

  assert.deepEqual(result, [commander("16.0.0")]);
});

// The bug this guards against: two repos depending on the same package at
// different versions used to share a single global row, so scanning repo B
// would silently overwrite repo A's version (and, via call_sites' FK,
// orphan its call sites too).
test("findChangedOrNew is scoped per repo - a different repo's version doesn't count as a change", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_B, [commander("10.0.0")]);

  assert.deepEqual(result, [commander("10.0.0")], "new to repo B, regardless of repo A's version");
});

test("upsert updates the existing row instead of adding a new one", () => {
  const db = new Database(":memory:");
  const repo = new PackagesRepository(db);
  repo.upsert(REPO_A, [commander("15.0.0")]);

  repo.upsert(REPO_A, [commander("16.0.0")]);

  const rows = db.connection.prepare("SELECT * FROM packages").all();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { current_version: string }).current_version, "16.0.0");
});

test("upsert keeps separate rows for the same package name in different repos", () => {
  const db = new Database(":memory:");
  const repo = new PackagesRepository(db);

  repo.upsert(REPO_A, [commander("15.0.0")]);
  repo.upsert(REPO_B, [commander("10.0.0")]);

  const rows = db.connection.prepare("SELECT repo_path, current_version FROM packages").all() as {
    repo_path: string;
    current_version: string;
  }[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.current_version).sort(), ["10.0.0", "15.0.0"]);
});

test("findNew is not scoped per repo - a package known from any repo isn't new", () => {
  const repo = new PackagesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findNew([commander("10.0.0")]);

  assert.deepEqual(result, [], "commander is already known globally, from repo A");
});

test("findNew treats a never-before-seen package name as new", () => {
  const repo = new PackagesRepository(new Database(":memory:"));

  const result = repo.findNew([commander("15.0.0")]);

  assert.deepEqual(result, [commander("15.0.0")]);
});
