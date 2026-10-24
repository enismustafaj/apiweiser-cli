import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../src/db/database.ts";
import { PAGE_SIZE } from "../../src/dashboard/db/dashboard-repository.ts";
import { PackagesRepository } from "../../src/dependencies/db/packages-repository.ts";
import { PullRequestsRepository } from "../../src/github/db/pull-requests-repository.ts";
import { createServer, parseState } from "../../src/dashboard/server.ts";

async function get(db: Database, path: string): Promise<string> {
  const res = await createServer(db).request(path);
  assert.equal(res.status, 200);
  return res.text();
}

function repoUrl(repoPath: string, rest = ""): string {
  return `/?repo=${encodeURIComponent(repoPath)}${rest}`;
}

test("GET / lists the scanned repos, even when there's only one", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/home/me/code/my-app", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const body = await get(db, "/");

  assert.match(body, /<h1>Repositories<\/h1>/);
  assert.match(body, /<strong>my-app<\/strong>/);
  assert.match(body, /href="\/\?repo=%2Fhome%2Fme%2Fcode%2Fmy-app"/);
  // The repo's packages are one click away, not on the landing page.
  assert.doesNotMatch(body, /commander/);
});

test("GET / with no repos explains how to scan one", async () => {
  assert.match(await get(new Database(":memory:"), "/"), /No repositories scanned yet\./);
});

test("GET /?repo=... shows that repo's direct dependencies", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/my-app", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);
  new PackagesRepository(db).upsert("/repos/other", [
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
  ]);

  const body = await get(db, repoUrl("/repos/my-app"));

  assert.match(body, /<span class="crumb">my-app<\/span>/);
  assert.match(body, /<strong>commander<\/strong>/);
  assert.match(body, /15\.0\.0/);
  assert.doesNotMatch(body, /ansi-styles/);
  assert.doesNotMatch(body, /chalk/);
});

test("GET /?repo=...&tab=pull-requests shows one row per PR with its packages", async () => {
  const db = new Database(":memory:");
  const prs = new PullRequestsRepository(db);
  const url = "https://github.com/a/a/pull/12";
  prs.insert({
    repoPath: "/repos/a",
    packageName: "@angular/core",
    version: "5.2.9",
    newVersion: "6.1.10",
    url,
  });
  prs.insert({
    repoPath: "/repos/a",
    packageName: "rxjs",
    version: "5.5.7",
    newVersion: "6.6.7",
    url,
  });

  const body = await get(db, repoUrl("/repos/a", "&tab=pull-requests"));

  assert.match(body, /<h1>Pull requests<\/h1>/);
  assert.equal([...body.matchAll(/href="https:\/\/github\.com\/a\/a\/pull\/12"/g)].length, 1);
  assert.match(body, /#12 ↗/);
  assert.match(body, /5\.2\.9 → 6\.1\.10/);
  assert.match(body, /5\.5\.7 → 6\.6\.7/);
});

test("old suggestions and updates links land on the pull requests tab", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  for (const tab of ["suggestions", "updates"]) {
    assert.match(await get(db, repoUrl("/repos/a", `&tab=${tab}`)), /<h1>Pull requests<\/h1>/);
  }
});

test("GET /?repo=... renders empty states", async () => {
  const db = new Database(":memory:");
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });
  new PackagesRepository(db).upsert("/repos/b", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  assert.match(await get(db, repoUrl("/repos/a")), /No direct dependencies recorded/);
  assert.match(await get(db, repoUrl("/repos/b", "&tab=pull-requests")), /No PRs opened yet\./);
});

test("GET /?repo=...&page=2 renders the second page", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert(
    "/repos/a",
    Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
      name: `pkg-${i}`,
      currentVersion: "1.0.0",
      type: "direct" as const,
    })),
  );

  const body = await get(db, repoUrl("/repos/a", "&page=2"));

  assert.match(body, /Page 2 of 2/);
  assert.equal([...body.matchAll(/<strong>pkg-\d+<\/strong>/g)].length, 1);
});

test("an unknown repo falls back to the repo list", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  assert.match(await get(db, repoUrl("/repos/nope")), /<h1>Repositories<\/h1>/);
});

test("search input is escaped when echoed back into the page", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const body = await get(db, repoUrl("/repos/a", "&q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"));

  assert.doesNotMatch(body, /<script>alert/);
});

test("parseState ignores unknown repos, tabs, and page numbers", () => {
  assert.equal(parseState({}, ["/a"]).repo, undefined);
  assert.equal(parseState({ repo: "/a" }, ["/a"]).repo, "/a");
  assert.equal(parseState({ repo: "/nope" }, ["/a"]).repo, undefined);
  assert.equal(parseState({ tab: "bogus" }, []).tab, "packages");
  assert.equal(parseState({ tab: "call-sites" }, []).tab, "packages");
  assert.equal(parseState({ tab: "updates" }, []).tab, "pull-requests");
  assert.equal(parseState({ page: "not-a-number" }, []).page, 1);
});
