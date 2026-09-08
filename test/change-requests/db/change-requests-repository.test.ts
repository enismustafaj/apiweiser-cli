import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeRequestsRepository } from "../../../src/change-requests/db/change-requests-repository.ts";
import type { ChangeRequestRecord } from "../../../src/change-requests/types.ts";
import { Database } from "../../../src/db/database.ts";

function record(overrides: Partial<ChangeRequestRecord> = {}): ChangeRequestRecord {
  return {
    repoPath: "/repos/a",
    packageName: "chalk",
    fromVersion: "4.1.0",
    toVersion: "5.0.0",
    summary: "Named exports replaced the default export",
    status: "pr_opened",
    prUrl: "https://github.com/acme/app/pull/7",
    codemodPath: "/codemods/chalk-5",
    ...overrides,
  };
}

test("insert stores an opened PR and reads it back", () => {
  const db = new Database(":memory:");
  const repo = new ChangeRequestsRepository(db);

  repo.insert(record());

  const [stored] = repo.findAll();
  assert.equal(stored.packageName, "chalk");
  assert.equal(stored.status, "pr_opened");
  assert.equal(stored.prUrl, "https://github.com/acme/app/pull/7");
  assert.equal(stored.fromVersion, "4.1.0");
  assert.equal(stored.toVersion, "5.0.0");
  assert.ok(stored.createdAt);
});

test("insert stores an attempt that produced no PR, with the reason", () => {
  const db = new Database(":memory:");
  const repo = new ChangeRequestsRepository(db);

  repo.insert(
    record({ status: "skipped", detail: "codemod produced no changes", prUrl: undefined }),
  );

  const [stored] = repo.findAll();
  assert.equal(stored.status, "skipped");
  assert.equal(stored.detail, "codemod produced no changes");
  assert.equal(stored.prUrl, null);
});

test("findAll filters by status and by package", () => {
  const db = new Database(":memory:");
  const repo = new ChangeRequestsRepository(db);
  repo.insert(record());
  repo.insert(record({ packageName: "openai", status: "codemod_failed", detail: "tests failed" }));

  assert.deepEqual(
    repo.findAll({ status: "codemod_failed" }).map((row) => row.packageName),
    ["openai"],
  );
  assert.deepEqual(
    repo.findAll({ packageName: "chalk" }).map((row) => row.status),
    ["pr_opened"],
  );
  assert.equal(repo.findAll().length, 2);
});
