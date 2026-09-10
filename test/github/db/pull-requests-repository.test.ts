import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { PullRequestsRepository } from "../../../src/github/db/pull-requests-repository.ts";

test("insert stores an opened pull request", () => {
  const db = new Database(":memory:");
  const repo = new PullRequestsRepository(db);

  repo.insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });

  const row = db.connection.prepare("SELECT * FROM pull_requests").get() as Record<string, unknown>;
  assert.equal(row.repo_path, "/repos/a");
  assert.equal(row.package_name, "chalk");
  assert.equal(row.version, "4.1.0");
  assert.equal(row.new_version, "5.0.0");
  assert.equal(row.url, "https://github.com/a/a/pull/1");
});

test("insert allows more than one PR for the same repo/package", () => {
  const db = new Database(":memory:");
  const repo = new PullRequestsRepository(db);

  repo.insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "4.1.0",
    newVersion: "5.0.0",
    url: "https://github.com/a/a/pull/1",
  });
  repo.insert({
    repoPath: "/repos/a",
    packageName: "chalk",
    version: "5.0.0",
    newVersion: "5.2.0",
    url: "https://github.com/a/a/pull/2",
  });

  const rows = db.connection.prepare("SELECT url FROM pull_requests ORDER BY id").all() as {
    url: string;
  }[];
  assert.deepEqual(
    rows.map((r) => r.url),
    ["https://github.com/a/a/pull/1", "https://github.com/a/a/pull/2"],
  );
});
