import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../src/db/database.ts";
import { PAGE_SIZE } from "../../src/dashboard/db/dashboard-repository.ts";
import { CallSitesRepository } from "../../src/dependencies/db/call-sites-repository.ts";
import { PackagesRepository } from "../../src/dependencies/db/packages-repository.ts";
import { PullRequestsRepository } from "../../src/github/db/pull-requests-repository.ts";
import { createServer, parseState } from "../../src/dashboard/server.ts";

async function get(db: Database, path: string): Promise<string> {
  const res = await createServer(db).request(path);
  assert.equal(res.status, 200);
  return res.text();
}

test("GET / renders the direct packages of the only scanned repo", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/long/path/to/my-app", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);

  const body = await get(db, "/");

  assert.match(body, /commander/);
  assert.match(body, /15\.0\.0/);
  // Direct only by default; the transitive one is just counted in the toggle.
  assert.doesNotMatch(body, /<strong>ansi-styles<\/strong>/);
  assert.match(body, /Transitive <span class="count">1<\/span>/);
  // One repo: named in the header, no per-row Repo column.
  assert.match(body, /<span class="crumb" title="\/repos\/long\/path\/to\/my-app">my-app<\/span>/);
  assert.doesNotMatch(body, /<th>Repo<\/th>/);
});

test("GET /?tab=packages&type=all shows transitive packages too", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
    { name: "ansi-styles", currentVersion: "6.0.0", type: "transitive" },
  ]);

  const body = await get(db, "/?tab=packages&type=all");

  assert.match(body, /<strong>ansi-styles<\/strong>/);
  assert.match(body, /<th>Type<\/th>/);
});

test("GET / across several repos shows a repo picker and a short Repo column", async () => {
  const db = new Database(":memory:");
  const packages = new PackagesRepository(db);
  packages.upsert("/home/me/code/api", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  packages.upsert("/home/me/code/web", [
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
  ]);

  const body = await get(db, "/");

  assert.match(body, /<select name="repo"/);
  assert.match(body, /All repos \(2\)/);
  assert.match(body, /<th>Repo<\/th>/);
  assert.match(body, /title="\/home\/me\/code\/web">web<\/span>/);

  const scoped = await get(db, "/?repo=%2Fhome%2Fme%2Fcode%2Fweb");
  assert.match(scoped, /chalk/);
  assert.doesNotMatch(scoped, /commander/);
});

test("GET / renders empty states when the db is empty", async () => {
  const db = new Database(":memory:");

  assert.match(await get(db, "/"), /No packages scanned yet\./);
  assert.match(await get(db, "/?tab=call-sites"), /No call sites recorded yet\./);
  assert.match(await get(db, "/?tab=suggestions"), /No suggestions yet/);
  assert.match(await get(db, "/?tab=pull-requests"), /No PRs opened yet\./);
});

test("GET /?tab=pull-requests renders opened PRs", async () => {
  const db = new Database(":memory:");
  new PullRequestsRepository(db).insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });

  const body = await get(db, "/?tab=pull-requests");

  assert.match(body, /View PR/);
  assert.match(body, /4\.1\.0 → 5\.0\.0/);
});

test("GET /?tab=call-sites&package=... drills into one package's call sites", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "chalk", currentVersion: "5.0.0", type: "direct" },
  ]);
  new CallSitesRepository(db).insert("/repos/a", [
    {
      dependency: "chalk",
      file: "/repos/a/src/log.ts",
      line: 3,
      snippet: "chalk.red(msg)",
      apiSurface: "chalk.red",
    },
    {
      dependency: "chalk",
      file: "/repos/a/src/log.ts",
      line: 9,
      snippet: "chalk.green(\n  msg,\n)",
      apiSurface: "chalk.green",
    },
  ]);

  const body = await get(db, "/?tab=call-sites&package=chalk");

  assert.match(body, /src\/log\.ts:3/);
  assert.doesNotMatch(body, /\/repos\/a\/src/);
  assert.match(body, /2 call sites across 2 APIs/);
  // Multi-line snippets fold behind their first line.
  assert.match(body, /<details class="snippet">/);
  assert.match(body, /\+2 lines/);
});

test("GET /?tab=packages&page=2 renders the second page", async () => {
  const db = new Database(":memory:");
  const dependencies = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
    name: `pkg-${i}`,
    currentVersion: "1.0.0",
    type: "direct" as const,
  }));
  new PackagesRepository(db).upsert("/repos/a", dependencies);

  const body = await get(db, "/?tab=packages&page=2");

  assert.match(body, /Page 2 of 2/);
  assert.equal([...body.matchAll(/<strong>pkg-\d+<\/strong>/g)].length, 1);
});

test("GET /?tab=breaking-changes falls back to the packages tab now that it's gone", async () => {
  const db = new Database(":memory:");

  assert.match(await get(db, "/?tab=breaking-changes"), /No packages scanned yet\./);
});

test("GET / with a garbage page param falls back to page 1 instead of erroring", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  assert.match(await get(db, "/?page=not-a-number"), /commander/);
});

test("search input is escaped when echoed back into the page", async () => {
  const db = new Database(":memory:");

  const body = await get(db, "/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E");

  assert.doesNotMatch(body, /<script>alert/);
});

test("parseState picks the only repo, ignores unknown repos, and defaults to direct", () => {
  assert.equal(parseState({}, ["/a"]).repo, "/a");
  assert.equal(parseState({}, ["/a", "/b"]).repo, undefined);
  assert.equal(parseState({ repo: "" }, ["/a"]).repo, undefined);
  assert.equal(parseState({ repo: "/nope" }, ["/a", "/b"]).repo, undefined);
  assert.equal(parseState({}, []).type, "direct");
  assert.equal(parseState({ type: "all" }, []).type, undefined);
  assert.equal(parseState({ tab: "bogus" }, []).tab, "packages");
});
