import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../src/db/database.ts";
import { PAGE_SIZE } from "../../src/dashboard/db/dashboard-repository.ts";
import { PackagesRepository } from "../../src/dependencies/db/packages-repository.ts";
import { PullRequestsRepository } from "../../src/github/db/pull-requests-repository.ts";
import { createServer } from "../../src/dashboard/server.ts";

test("GET / renders the packages, suggestions, and PRs stored in the db", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });
  const app = createServer(db);

  const res = await app.request("/");

  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /commander/);
  assert.match(body, /15\.0\.0/);
  assert.match(body, /View PR/);
  assert.match(body, /No suggestions yet\./);
});

test("GET / renders empty states when the db is empty", async () => {
  const app = createServer(new Database(":memory:"));

  const body = await (await app.request("/")).text();

  assert.match(body, /No packages scanned yet\./);
  assert.match(body, /No suggestions yet\./);
  assert.match(body, /No PRs opened yet\./);
});

test("GET /?packagesPage=2 renders the second page and pre-selects the packages tab", async () => {
  const db = new Database(":memory:");
  const dependencies = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
    name: `pkg-${i}`,
    currentVersion: "1.0.0",
    type: "direct" as const,
  }));
  new PackagesRepository(db).upsert("/repos/a", dependencies);
  const app = createServer(db);

  const body = await (await app.request("/?tab=packages&packagesPage=2")).text();

  assert.match(body, /Page 2 of 2/);
  assert.equal([...body.matchAll(/pkg-\d+/g)].length, 1);
});

test("GET / with a garbage page param falls back to page 1 instead of erroring", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const app = createServer(db);

  const res = await app.request("/?packagesPage=not-a-number");

  assert.equal(res.status, 200);
  assert.match(await res.text(), /commander/);
});
