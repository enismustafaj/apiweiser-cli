import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { DataSourcesRepository } from "../../../src/data-sources/db/data-sources-repository.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import { plainRows } from "../../support/plain-rows.ts";

function setup() {
  const db = new Database(":memory:");
  new PackagesRepository(db).upsert("/repos/a", [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);
  const packageId = (
    db.connection.prepare("SELECT id FROM packages WHERE name = ?").get("commander") as {
      id: number;
    }
  ).id;
  return { dataSources: new DataSourcesRepository(db), packageId };
}

test("insert stores a package_id -> url mapping", () => {
  const { dataSources, packageId } = setup();

  dataSources.insert(
    new Map([[packageId, "https://api.github.com/repos/tj/commander.js/releases"]]),
  );

  assert.deepEqual(plainRows(dataSources.listAll()), [
    { packageId, url: "https://api.github.com/repos/tj/commander.js/releases" },
  ]);
});

test("listAll returns an empty array when nothing has been recorded", () => {
  const { dataSources } = setup();

  assert.deepEqual(dataSources.listAll(), []);
});
