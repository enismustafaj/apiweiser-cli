import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { ChangelogSourcesRepository } from "../../../src/changelogs/db/changelog-sources-repository.ts";
import { DependenciesRepository } from "../../../src/dependencies/db/dependencies-repository.ts";

function setup() {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const packageId = (
    db.connection.prepare("SELECT id FROM packages WHERE name = ?").get("commander") as {
      id: number;
    }
  ).id;
  return { changelogs: new ChangelogSourcesRepository(db), packageId };
}

test("insert records a source that findUrl finds by package name", () => {
  const { changelogs, packageId } = setup();
  changelogs.insert(
    new Map([[packageId, "https://api.github.com/repos/tj/commander.js/releases"]]),
  );

  assert.equal(
    changelogs.findUrl("commander"),
    "https://api.github.com/repos/tj/commander.js/releases",
  );
});

test("findUrl returns null for a package with no recorded source", () => {
  const { changelogs } = setup();

  assert.equal(changelogs.findUrl("commander"), null);
});
