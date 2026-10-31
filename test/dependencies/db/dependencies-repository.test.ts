import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DependenciesRepository } from "../../../src/dependencies/db/dependencies-repository.ts";
import type { CallSite, Dependency } from "../../../src/dependencies/types.ts";
import { plainRows } from "../../support/plain-rows.ts";

const REPO_A = "/repos/a";
const REPO_B = "/repos/b";

function commander(currentVersion: string): Dependency {
  return { name: "commander", currentVersion, type: "direct" };
}

test("findChangedOrNew treats an unseen dependency as new", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));

  const result = repo.findChangedOrNew(REPO_A, [commander("15.0.0")]);

  assert.deepEqual(result, [commander("15.0.0")]);
});

test("findChangedOrNew skips a dependency whose version hasn't changed", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_A, [commander("15.0.0")]);

  assert.deepEqual(result, []);
});

test("findChangedOrNew includes a dependency whose version changed", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_A, [commander("16.0.0")]);

  assert.deepEqual(result, [commander("16.0.0")]);
});

// The bug this guards against: two repos depending on the same package at
// different versions used to share a single global row, so scanning repo B
// would silently overwrite repo A's version (and, via call_sites' FK,
// orphan its call sites too).
test("findChangedOrNew is scoped per repo - a different repo's version doesn't count as a change", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);

  const result = repo.findChangedOrNew(REPO_B, [commander("10.0.0")]);

  assert.deepEqual(result, [commander("10.0.0")], "new to repo B, regardless of repo A's version");
});

test("upsert updates the existing row instead of adding a new one", () => {
  const db = new Database(":memory:");
  const repo = new DependenciesRepository(db);
  repo.upsert(REPO_A, [commander("15.0.0")]);

  repo.upsert(REPO_A, [commander("16.0.0")]);

  const rows = db.connection.prepare("SELECT * FROM packages").all();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { current_version: string }).current_version, "16.0.0");
});

test("upsert keeps separate rows for the same package name in different repos", () => {
  const db = new Database(":memory:");
  const repo = new DependenciesRepository(db);

  repo.upsert(REPO_A, [commander("15.0.0")]);
  repo.upsert(REPO_B, [commander("10.0.0")]);

  const rows = db.connection.prepare("SELECT repo_path, current_version FROM packages").all() as {
    repo_path: string;
    current_version: string;
  }[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.current_version).sort(), ["10.0.0", "15.0.0"]);
});

test("findVersion returns the stored version for this repo only", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [commander("15.0.0")]);
  repo.upsert(REPO_B, [commander("10.0.0")]);

  assert.equal(repo.findVersion(REPO_A, "commander"), "15.0.0");
  assert.equal(repo.findVersion(REPO_B, "commander"), "10.0.0");
});

test("findVersion returns null for a package this repo doesn't have", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));

  assert.equal(repo.findVersion(REPO_A, "commander"), null);
});

test("findDirect returns only this repo's direct dependencies", () => {
  const repo = new DependenciesRepository(new Database(":memory:"));
  repo.upsert(REPO_A, [
    commander("15.0.0"),
    { name: "chalk", currentVersion: "5.0.0", type: "transitive" },
  ]);
  repo.upsert(REPO_B, [{ name: "rxjs", currentVersion: "7.0.0", type: "direct" }]);

  // node:sqlite rows are null-prototype objects - spread to compare values.
  assert.deepEqual(
    repo.findDirect(REPO_A).map((row) => ({ ...row })),
    [{ name: "commander", currentVersion: "15.0.0" }],
  );
});

function setup() {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  return { db, callSites: new DependenciesRepository(db) };
}

function callSite(overrides: Partial<CallSite> = {}): CallSite {
  return {
    dependency: "commander",
    file: "src/main.ts",
    line: 4,
    snippet: "new Command()",
    apiSurface: "Command",
    ...overrides,
  };
}

test("insertCallSites resolves package_id from the dependency name", () => {
  const { db, callSites } = setup();

  callSites.insertCallSites(REPO_A, [callSite()]);

  const rows = db.connection
    .prepare(
      `SELECT p.name AS dependency, cs.api_surface
       FROM call_sites cs JOIN packages p ON p.id = cs.package_id`,
    )
    .all();
  assert.deepEqual(plainRows(rows), [{ dependency: "commander", api_surface: "Command" }]);
});

test("insertCallSites fails for a dependency with no matching package (FK enforced)", () => {
  const { callSites } = setup();

  assert.throws(() => {
    callSites.insertCallSites(REPO_A, [callSite({ dependency: "unknown-package" })]);
  });
});

test("insertCallSites resolves against this repo's package row, not another repo's same-named one", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const callSites = new DependenciesRepository(db);

  // No "commander" package row for REPO_B - the FK subquery must not fall
  // back to REPO_A's row just because the name matches.
  assert.throws(() => {
    callSites.insertCallSites(REPO_B, [callSite()]);
  });
});

test("deleteCallSites removes only the named dependency's rows", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ts-morph", currentVersion: "28.0.0", type: "direct" },
  ]);
  const callSites = new DependenciesRepository(db);
  callSites.insertCallSites(REPO_A, [
    callSite({ dependency: "commander" }),
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
  ]);

  callSites.deleteCallSites(REPO_A, ["commander"]);

  const remaining = db.connection
    .prepare(
      `SELECT p.name AS dependency
       FROM call_sites cs JOIN packages p ON p.id = cs.package_id`,
    )
    .all();
  assert.deepEqual(plainRows(remaining), [{ dependency: "ts-morph" }]);
});

test("deleteCallSites doesn't touch another repo's call sites for the same package", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  new DependenciesRepository(db).upsert(REPO_B, [
    { name: "commander", currentVersion: "10.0.0", type: "direct" },
  ]);
  const callSites = new DependenciesRepository(db);
  callSites.insertCallSites(REPO_A, [callSite()]);
  callSites.insertCallSites(REPO_B, [callSite()]);

  callSites.deleteCallSites(REPO_A, ["commander"]);

  assert.deepEqual(callSites.findCallSites(REPO_A, "commander"), []);
  assert.equal(callSites.findCallSites(REPO_B, "commander").length, 1);
});

test("deleteCallSites is a no-op for an empty list", () => {
  const { db, callSites } = setup();
  callSites.insertCallSites(REPO_A, [callSite()]);

  callSites.deleteCallSites(REPO_A, []);

  const count = db.connection.prepare("SELECT COUNT(*) AS n FROM call_sites").get() as {
    n: number;
  };
  assert.equal(count.n, 1);
});

test("findCallSites returns only the named dependency's call sites", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ts-morph", currentVersion: "28.0.0", type: "direct" },
  ]);
  const callSites = new DependenciesRepository(db);
  callSites.insertCallSites(REPO_A, [
    callSite({ dependency: "commander" }),
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
  ]);

  const result = callSites.findCallSites(REPO_A, "commander");

  assert.deepEqual(plainRows(result), [callSite({ dependency: "commander" })]);
});

test("findCallSites returns an empty array for a dependency with no call sites", () => {
  const { callSites } = setup();

  assert.deepEqual(callSites.findCallSites(REPO_A, "commander"), []);
});

test("findCallSitesForRepo returns every dependency's call sites for that repo only", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ts-morph", currentVersion: "28.0.0", type: "direct" },
  ]);
  new DependenciesRepository(db).upsert(REPO_B, [
    { name: "commander", currentVersion: "10.0.0", type: "direct" },
  ]);
  const callSites = new DependenciesRepository(db);
  callSites.insertCallSites(REPO_A, [
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
    callSite({ dependency: "commander" }),
  ]);
  callSites.insertCallSites(REPO_B, [callSite()]);

  const result = callSites.findCallSitesForRepo(REPO_A);

  assert.deepEqual(plainRows(result), [
    callSite({ dependency: "commander" }),
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
  ]);
});
