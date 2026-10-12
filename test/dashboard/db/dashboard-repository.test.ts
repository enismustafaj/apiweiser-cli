import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DashboardRepository, PAGE_SIZE } from "../../../src/dashboard/db/dashboard-repository.ts";
import { CallSitesRepository } from "../../../src/dependencies/db/call-sites-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";
import { PullRequestsRepository } from "../../../src/github/db/pull-requests-repository.ts";
import { SuggestionsRepository } from "../../../src/suggestions/db/suggestions-repository.ts";

function seedPackages(db: Database, repoPath: string, dependencies: Dependency[]): Dependency[] {
  new PackagesRepository(db).upsert(repoPath, dependencies);
  return dependencies;
}

function seedCallSites(
  db: Database,
  repoPath: string,
  dependency: string,
  sites: { file: string; apiSurface: string; snippet?: string }[],
): void {
  new CallSitesRepository(db).insert(
    repoPath,
    sites.map((site, i) => ({
      dependency,
      file: `${repoPath}/${site.file}`,
      line: i + 1,
      snippet: site.snippet ?? `${site.apiSurface}()`,
      apiSurface: site.apiSurface,
    })),
  );
}

test("listPackages returns page 1 of the scanned packages across repos", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "commander", currentVersion: "15.0.0", type: "direct" }]);

  const result = new DashboardRepository(db).listPackages({}, 1);

  assert.equal(result.total, 1);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.repoPath, "/repos/a");
  assert.equal(result.rows[0]!.name, "commander");
  assert.equal(result.rows[0]!.currentVersion, "15.0.0");
  assert.equal(result.rows[0]!.type, "direct");
  assert.equal(result.rows[0]!.callSites, 0);
});

test("listPackages paginates once there are more rows than fit on one page", () => {
  const db = new Database(":memory:");
  const dependencies = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
    name: `pkg-${i}`,
    currentVersion: "1.0.0",
    type: "direct" as const,
  }));
  seedPackages(db, "/repos/a", dependencies);
  const repo = new DashboardRepository(db);

  const page1 = repo.listPackages({}, 1);
  const page2 = repo.listPackages({}, 2);

  assert.equal(page1.total, PAGE_SIZE + 5);
  assert.equal(page1.totalPages, 2);
  assert.equal(page1.rows.length, PAGE_SIZE);
  assert.equal(page2.rows.length, 5);
});

test("listPackages lists direct dependencies first, most-called first", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "a-transitive", currentVersion: "1.0.0", type: "transitive" },
    { name: "b-direct-unused", currentVersion: "1.0.0", type: "direct" },
    { name: "c-direct-used", currentVersion: "1.0.0", type: "direct" },
  ]);
  seedCallSites(db, "/repos/a", "c-direct-used", [
    { file: "src/x.ts", apiSurface: "run" },
    { file: "src/y.ts", apiSurface: "run" },
  ]);

  const rows = new DashboardRepository(db).listPackages({}, 1).rows;

  assert.deepEqual(
    rows.map((r) => [r.name, r.callSites]),
    [
      ["c-direct-used", 2],
      ["b-direct-unused", 0],
      ["a-transitive", 0],
    ],
  );
});

test("listPackages filters by repo, type, and name search", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
    { name: "chalk-template", currentVersion: "1.0.0", type: "transitive" },
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  seedPackages(db, "/repos/b", [{ name: "chalk", currentVersion: "4.0.0", type: "direct" }]);
  const repo = new DashboardRepository(db);

  const names = (filter: Parameters<DashboardRepository["listPackages"]>[0]) =>
    repo.listPackages(filter, 1).rows.map((r) => `${r.repoPath}:${r.name}`);

  assert.deepEqual(names({ repo: "/repos/b" }), ["/repos/b:chalk"]);
  assert.deepEqual(names({ repo: "/repos/a", type: "direct", q: "chalk" }), ["/repos/a:chalk"]);
  assert.deepEqual(names({ repo: "/repos/a", q: "chalk" }).sort(), [
    "/repos/a:chalk",
    "/repos/a:chalk-template",
  ]);
  assert.deepEqual(repo.packageTypeCounts({ repo: "/repos/a", q: "chalk" }), {
    direct: 1,
    transitive: 1,
  });
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

test("listRepos includes repos that only have suggestions or PRs", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "chalk", currentVersion: "5.0.0", type: "direct" }]);
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/b",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/b/b/pull/1",
  });

  assert.deepEqual(new DashboardRepository(db).listRepos(), ["/repos/a", "/repos/b"]);
});

test("summary counts are scoped to the selected repo", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);
  seedPackages(db, "/repos/b", [{ name: "commander", currentVersion: "15.0.0", type: "direct" }]);
  seedCallSites(db, "/repos/a", "chalk", [{ file: "src/x.ts", apiSurface: "chalk.red" }]);

  const repo = new DashboardRepository(db);
  const a = repo.summary("/repos/a");
  const all = repo.summary(undefined);

  assert.equal(a.direct, 1);
  assert.equal(a.transitive, 1);
  assert.equal(a.callSites, 1);
  assert.equal(a.packagesWithCallSites, 1);
  assert.equal(all.direct, 2);
  assert.equal(repo.summary("/repos/b").callSites, 0);
});

test("listCallSiteUsage summarises call sites per package", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "chalk", currentVersion: "5.0.0", type: "direct" }]);
  seedCallSites(db, "/repos/a", "chalk", [
    { file: "src/x.ts", apiSurface: "chalk.red" },
    { file: "src/x.ts", apiSurface: "chalk.green" },
    { file: "src/y.ts", apiSurface: "chalk.red" },
  ]);

  const row = new DashboardRepository(db).listCallSiteUsage({}, 1).rows[0]!;

  assert.equal(row.packageName, "chalk");
  assert.equal(row.callSites, 3);
  assert.equal(row.files, 2);
  assert.equal(row.apiSurfaces, 2);
});

test("listCallSites returns repo-relative files, filterable by API and search", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "chalk", currentVersion: "5.0.0", type: "direct" }]);
  seedCallSites(db, "/repos/a", "chalk", [
    { file: "src/x.ts", apiSurface: "chalk.red" },
    { file: "src/y.ts", apiSurface: "chalk.green" },
    { file: "lib/z.ts", apiSurface: "chalk.red" },
  ]);
  const repo = new DashboardRepository(db);

  const all = repo.listCallSites({ packageName: "chalk" }, 1).rows;
  const red = repo.listCallSites({ packageName: "chalk", api: "chalk.red" }, 1).rows;
  const inSrc = repo.listCallSites({ packageName: "chalk", q: "src/" }, 1).rows;

  assert.deepEqual(
    all.map((c) => c.file),
    ["lib/z.ts", "src/x.ts", "src/y.ts"],
  );
  assert.deepEqual(
    red.map((c) => c.file),
    ["lib/z.ts", "src/x.ts"],
  );
  assert.deepEqual(
    inSrc.map((c) => c.file),
    ["src/x.ts", "src/y.ts"],
  );
  assert.deepEqual(
    repo.apiSurfaceCounts(undefined, "chalk").map((a) => [a.apiSurface, a.count]),
    [
      ["chalk.red", 2],
      ["chalk.green", 1],
    ],
  );
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

  const result = new DashboardRepository(db).listSuggestions({}, 1);

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

  const result = new DashboardRepository(db).listPullRequests({}, 1);

  assert.equal(result.total, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.url, "https://github.com/a/a/pull/1");
});

test("an out-of-range page number returns an empty rows array, not an error", () => {
  const db = new Database(":memory:");
  seedPackages(db, "/repos/a", [{ name: "commander", currentVersion: "15.0.0", type: "direct" }]);

  const result = new DashboardRepository(db).listPackages({}, 5);

  assert.equal(result.rows.length, 0);
  assert.equal(result.total, 1);
});
