import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DashboardRepository, PAGE_SIZE } from "../../../src/dashboard/db/dashboard-repository.ts";
import { DependenciesRepository } from "../../../src/dependencies/db/dependencies-repository.ts";

test("listPackages returns page 1 of the scanned packages across repos", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert("/repos/a", [
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
  new DependenciesRepository(db).upsert("/repos/a", dependencies);
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
  // Nothing writes suggestions any more - rows from older versions still show.
  db.connection
    .prepare(
      `INSERT INTO suggestions (repo_path, dependency, package_file, dep_type,
         current_version, new_version, update_type, datasource)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "/repos/a",
      "commander",
      "package.json",
      "dependencies",
      "15.0.0",
      "16.0.0",
      "major",
      "npm",
    );

  const result = new DashboardRepository(db).listSuggestions(1);

  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.dependency, "commander");
  assert.equal(result.rows[0]!.newVersion, "16.0.0");
});

test("listPullRequests returns the newest opened PR first", () => {
  const db = new Database(":memory:");
  // Nothing writes pull_requests any more - rows from older versions still show.
  db.connection
    .prepare(
      `INSERT INTO pull_requests (repo_path, package_name, version, new_version, url)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run("/repos/a", "chalk", "4.1.0", "5.0.0", "https://github.com/a/a/pull/1");

  const result = new DashboardRepository(db).listPullRequests(1);

  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.url, "https://github.com/a/a/pull/1");
});

test("an out-of-range page number returns an empty rows array, not an error", () => {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const result = new DashboardRepository(db).listPackages(5);

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 1);
});
