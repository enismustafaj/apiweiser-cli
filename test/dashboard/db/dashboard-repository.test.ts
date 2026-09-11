import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DashboardRepository, PAGE_SIZE } from "../../../src/dashboard/db/dashboard-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import { PullRequestsRepository } from "../../../src/github/db/pull-requests-repository.ts";
import { SuggestionsRepository } from "../../../src/suggestions/db/suggestions-repository.ts";

test("listPackages returns page 1 of the scanned packages across repos", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const result = new DashboardRepository(db).listPackages(1);

  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.repoPath, "/repos/a");
  assert.equal(result.rows[0]!.name, "commander");
  assert.equal(result.rows[0]!.currentVersion, "15.0.0");
  assert.equal(result.rows[0]!.type, "direct");
});

test("listPackages paginates once there are more rows than fit on one page", () => {
  const db = new Database(":memory:");
  const dependencies = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
    name: `pkg-${i}`,
    currentVersion: "1.0.0",
    type: "direct" as const,
  }));
  new PackagesRepository(db).upsert("/repos/a", dependencies);
  const repo = new DashboardRepository(db);

  const page1 = repo.listPackages(1);
  const page2 = repo.listPackages(2);

  assert.equal(page1.total, PAGE_SIZE + 5);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.rows.length, PAGE_SIZE);
  assert.equal(page2.rows.length, 5);
});

test("listSuggestions returns the newest stored suggestion first", () => {
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

  const result = new DashboardRepository(db).listSuggestions(1);

  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.dependency, "commander");
  assert.equal(result.rows[0]!.newVersion, "16.0.0");
});

test("listPullRequests returns the newest opened PR first", () => {
  const db = new Database(":memory:");
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });

  const result = new DashboardRepository(db).listPullRequests(1);

  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.url, "https://github.com/a/a/pull/1");
});

test("an out-of-range page number returns an empty rows array, not an error", () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const result = new DashboardRepository(db).listPackages(5);

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 1);
});
