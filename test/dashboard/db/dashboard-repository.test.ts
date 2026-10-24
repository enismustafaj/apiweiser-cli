import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DashboardRepository, PAGE_SIZE } from "../../../src/dashboard/db/dashboard-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";
import { PullRequestsRepository } from "../../../src/github/db/pull-requests-repository.ts";

function seedPackages(db: Database, repoPath: string, dependencies: Dependency[]): void {
  new PackagesRepository(db).upsert(repoPath, dependencies);
}

function seedPullRequest(
  db: Database,
  repoPath: string,
  packageName: string,
  version: string,
  newVersion: string,
  url: string,
): void {
  new PullRequestsRepository(db).insert({ repoPath, packageName, version, newVersion, url });
}

test("listPackages returns a repo's direct dependencies by name, without transitive ones", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);
  seedPackages(db, "/repos/b", [{ name: "zod", currentVersion: "3.0.0", type: "direct" }]);

  const result = new DashboardRepository(db).listPackages({ repo: "/repos/a" }, 1);

  assert.equal(result.total, 2);
  assert.deepEqual(
    result.rows.map((r) => ({ ...r })),
    [
      { name: "chalk", currentVersion: "5.0.0" },
      { name: "commander", currentVersion: "15.0.0" },
    ],
  );
});

test("listPackages paginates once there are more rows than fit on one page", () => {
  const db = new Database(":memory:");
  seedPackages(
    db,
    "/repos/a",
    Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
      name: `pkg-${String(i).padStart(2, "0")}`,
      currentVersion: "1.0.0",
      type: "direct" as const,
    })),
  );

  const repo = new DashboardRepository(db);
  const first = repo.listPackages({}, 1);
  const second = repo.listPackages({}, 2);

  assert.equal(first.rows.length, PAGE_SIZE);
  assert.equal(first.totalPages, 2);
  assert.equal(second.rows.length, 5);
  assert.equal(second.total, PAGE_SIZE + 5);
});

test("search treats LIKE wildcards in the query literally", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "foo_bar", currentVersion: "1.0.0", type: "direct" },
    { name: "fooXbar", currentVersion: "1.0.0", type: "direct" },
  ]);

  const rows = new DashboardRepository(db).listPackages({ q: "foo_bar" }, 1).rows;

  assert.deepEqual(
    rows.map((r) => r.name),
    ["foo_bar"],
  );
});

test("repoSummaries lists every repo, including ones with only PRs", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "chalk", currentVersion: "4.1.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);
  seedPullRequest(db, "/repos/b", "chalk", "4.1.0", "5.0.0", "https://github.com/b/b/pull/1");

  const repos = new DashboardRepository(db).repoSummaries();

  assert.deepEqual(
    repos.map((r) => ({ ...r })),
    [
      { repoPath: "/repos/a", dependencies: 1, pullRequests: 0 },
      { repoPath: "/repos/b", dependencies: 0, pullRequests: 1 },
    ],
  );
});

test("repoSummaries counts a group PR once and can be scoped to one repo", () => {
  const db = new Database(":memory:");
  const url = "https://github.com/a/a/pull/7";
  seedPullRequest(db, "/repos/a", "@angular/core", "5.2.9", "6.1.10", url);
  seedPullRequest(db, "/repos/a", "@angular/common", "5.2.9", "6.1.10", url);
  seedPackages(db, "/repos/b", [{ name: "zod", currentVersion: "3.0.0", type: "direct" }]);

  const repos = new DashboardRepository(db).repoSummaries("/repos/a");

  assert.equal(repos.length, 1);
  assert.equal(repos[0]!.pullRequests, 1);
});

test("listPullRequests gathers a group PR's packages into one row", () => {
  const db = new Database(":memory:");
  const url = "https://github.com/a/a/pull/7";
  seedPullRequest(db, "/repos/a", "@angular/core", "5.2.9", "6.1.10", url);
  seedPullRequest(db, "/repos/a", "@angular/common", "5.2.9", "6.1.10", url);
  seedPullRequest(db, "/repos/a", "chalk", "4.1.0", "5.0.0", "https://github.com/a/a/pull/8");

  const result = new DashboardRepository(db).listPullRequests({ repo: "/repos/a" }, 1);

  assert.equal(result.total, 2);
  const group = result.rows.find((r) => r.url === url)!;
  assert.deepEqual(group.packages.map((p) => p.name).sort(), ["@angular/common", "@angular/core"]);
  assert.deepEqual(group.packages[0]!.version, "5.2.9");
  assert.deepEqual(group.packages[0]!.newVersion, "6.1.10");
});

test("listPullRequests search matches any package and returns the whole PR", () => {
  const db = new Database(":memory:");
  const url = "https://github.com/a/a/pull/7";
  seedPullRequest(db, "/repos/a", "@angular/core", "5.2.9", "6.1.10", url);
  seedPullRequest(db, "/repos/a", "rxjs", "5.5.7", "6.6.7", url);
  seedPullRequest(db, "/repos/a", "chalk", "4.1.0", "5.0.0", "https://github.com/a/a/pull/8");
  seedPullRequest(db, "/repos/b", "rxjs", "5.5.7", "6.6.7", "https://github.com/b/b/pull/1");

  const rows = new DashboardRepository(db).listPullRequests(
    { repo: "/repos/a", q: "rxjs" },
    1,
  ).rows;

  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.url, url);
  assert.equal(rows[0]!.packages.length, 2);
});

test("an out-of-range page number returns an empty rows array, not an error", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "commander", currentVersion: "15.0.0", type: "direct" }]);

  const result = new DashboardRepository(db).listPackages({}, 5);

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 1);
});
