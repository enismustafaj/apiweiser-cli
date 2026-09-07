import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { CallSitesRepository } from "../../../src/dependencies/db/call-sites-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { CallSite } from "../../../src/dependencies/types.ts";
import { plainRows } from "../../support/plain-rows.ts";

const REPO_A = "/repos/a";
const REPO_B = "/repos/b";

function setup() {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  return { db, callSites: new CallSitesRepository(db) };
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

test("insert resolves package_id from the dependency name", () => {
  const { db, callSites } = setup();

  callSites.insert(REPO_A, [callSite()]);

  const rows = db.connection
    .prepare(
      `SELECT p.name AS dependency, cs.api_surface
       FROM call_sites cs JOIN packages p ON p.id = cs.package_id`,
    )
    .all();
  assert.deepEqual(plainRows(rows), [{ dependency: "commander", api_surface: "Command" }]);
});

test("insert fails for a dependency with no matching package (FK enforced)", () => {
  const { callSites } = setup();

  assert.throws(() => {
    callSites.insert(REPO_A, [callSite({ dependency: "unknown-package" })]);
  });
});

test("insert resolves against this repo's package row, not another repo's same-named one", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const callSites = new CallSitesRepository(db);

  // No "commander" package row for REPO_B - the FK subquery must not fall
  // back to REPO_A's row just because the name matches.
  assert.throws(() => {
    callSites.insert(REPO_B, [callSite()]);
  });
});

test("deleteForDependencies removes only the named dependency's rows", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ts-morph", currentVersion: "28.0.0", type: "direct" },
  ]);
  const callSites = new CallSitesRepository(db);
  callSites.insert(REPO_A, [
    callSite({ dependency: "commander" }),
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
  ]);

  callSites.deleteForDependencies(REPO_A, ["commander"]);

  const remaining = db.connection
    .prepare(
      `SELECT p.name AS dependency
       FROM call_sites cs JOIN packages p ON p.id = cs.package_id`,
    )
    .all();
  assert.deepEqual(plainRows(remaining), [{ dependency: "ts-morph" }]);
});

test("deleteForDependencies doesn't touch another repo's call sites for the same package", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  new PackagesRepository(db).upsert(REPO_B, [
    { name: "commander", currentVersion: "10.0.0", type: "direct" },
  ]);
  const callSites = new CallSitesRepository(db);
  callSites.insert(REPO_A, [callSite()]);
  callSites.insert(REPO_B, [callSite()]);

  callSites.deleteForDependencies(REPO_A, ["commander"]);

  assert.deepEqual(callSites.findForDependency(REPO_A, "commander"), []);
  assert.equal(callSites.findForDependency(REPO_B, "commander").length, 1);
});

test("deleteForDependencies is a no-op for an empty list", () => {
  const { db, callSites } = setup();
  callSites.insert(REPO_A, [callSite()]);

  callSites.deleteForDependencies(REPO_A, []);

  const count = db.connection.prepare("SELECT COUNT(*) AS n FROM call_sites").get() as {
    n: number;
  };
  assert.equal(count.n, 1);
});

test("findForDependency returns only the named dependency's call sites", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(REPO_A, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ts-morph", currentVersion: "28.0.0", type: "direct" },
  ]);
  const callSites = new CallSitesRepository(db);
  callSites.insert(REPO_A, [
    callSite({ dependency: "commander" }),
    callSite({ dependency: "ts-morph", apiSurface: "Project" }),
  ]);

  const result = callSites.findForDependency(REPO_A, "commander");

  assert.deepEqual(plainRows(result), [callSite({ dependency: "commander" })]);
});

test("findForDependency returns an empty array for a dependency with no call sites", () => {
  const { callSites } = setup();

  assert.deepEqual(callSites.findForDependency(REPO_A, "commander"), []);
});
