import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { PendingChangelogLookupsRepository } from "../../../src/data-sources/db/pending-changelog-lookups-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import type { Dependency } from "../../../src/dependencies/types.ts";

// upsert() mutates its argument objects with the assigned id (RETURNING id)
// - reused here directly rather than a separate findChangedOrNew() call,
// which wouldn't have that id set on a fresh object.
function setup() {
  const db = new Database(":memory:");
  const commander: Dependency = { name: "commander", currentVersion: "15.0.0", type: "direct" };
  const tsMorph: Dependency = { name: "ts-morph", currentVersion: "28.0.0", type: "direct" };
  new PackagesRepository(db).upsert([commander, tsMorph]);
  return { pending: new PendingChangelogLookupsRepository(db), commander, tsMorph };
}

test("enqueue then takeBatch returns the queued package", () => {
  const { pending, commander } = setup();

  pending.enqueue([commander]);

  const batch = pending.takeBatch(10);
  assert.equal(batch.length, 1);
  assert.equal(batch[0]?.packageName, "commander");
});

test("enqueue ignores a dependency with no id", () => {
  const { pending } = setup();

  pending.enqueue([{ name: "commander", currentVersion: "15.0.0", type: "direct" }]);

  assert.deepEqual(pending.takeBatch(10), []);
});

test("enqueue is idempotent for an already-queued package", () => {
  const { pending, commander } = setup();

  pending.enqueue([commander]);
  pending.enqueue([commander]);

  assert.equal(pending.takeBatch(10).length, 1);
});

test("takeBatch caps results at the given limit", () => {
  const { pending, commander, tsMorph } = setup();

  pending.enqueue([commander, tsMorph]);

  assert.equal(pending.takeBatch(1).length, 1);
});

test("remove takes an entry out of the queue", () => {
  const { pending, commander } = setup();
  pending.enqueue([commander]);
  const [entry] = pending.takeBatch(10);

  pending.remove(entry!.pendingId);

  assert.deepEqual(pending.takeBatch(10), []);
});
