import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DashboardRepository } from "../../../src/dashboard/db/dashboard-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import { PullRequestsRepository } from "../../../src/github/db/pull-requests-repository.ts";
import { SuggestionsRepository } from "../../../src/suggestions/db/suggestions-repository.ts";

test("listPackages returns every scanned package across repos", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const rows = new DashboardRepository(db).listPackages();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.repoPath, "/repos/a");
  assert.equal(rows[0]!.name, "commander");
  assert.equal(rows[0]!.currentVersion, "15.0.0");
  assert.equal(rows[0]!.type, "direct");
});

test("listSuggestions returns every stored suggestion, newest first", () => {
  const db = new Database(":memory:");
  new SuggestionsRepository(db).insert("/repos/a", [
    {
      dependency: "commander",
      packageFile: "package.json",
      depType: "dependencies",
      currentVersion: "15.0.0",
      newVersion: "16.0.0",
      updateType: "major",
      datasource: "npm",
    },
  ]);

  const rows = new DashboardRepository(db).listSuggestions();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.dependency, "commander");
  assert.equal(rows[0]!.newVersion, "16.0.0");
});

test("listPullRequests returns every opened PR, newest first", () => {
  const db = new Database(":memory:");
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });

  const rows = new DashboardRepository(db).listPullRequests();

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.url, "https://github.com/a/a/pull/1");
});
