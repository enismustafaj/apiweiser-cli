import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../src/db/database.ts";
import { PackagesRepository } from "../../src/dependencies/db/packages-repository.ts";
import { createServer } from "../../src/dashboard/server.ts";

test("GET /api/packages returns the packages stored in the db", async () => {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const app = createServer(db);

  const res = await app.request("/api/packages");

  assert.equal(res.status, 200);
  const body = (await res.json()) as unknown[];
  assert.equal(body.length, 1);
});

test("GET /api/suggestions and /api/pull-requests start out empty", async () => {
  const app = createServer(new Database(":memory:"));

  const suggestions = await app.request("/api/suggestions");
  const pullRequests = await app.request("/api/pull-requests");

  assert.deepEqual(await suggestions.json(), []);
  assert.deepEqual(await pullRequests.json(), []);
});
