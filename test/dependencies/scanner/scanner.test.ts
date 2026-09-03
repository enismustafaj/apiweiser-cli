import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Scanner } from "../../../src/dependencies/scanner/scanner.ts";

// Resolved via node module resolution walking up to this repo's own
// node_modules, so the fixture doesn't need its own node_modules/commander -
// see docs/scanner.md.
const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/scanner-project", import.meta.url));

test("findCallSites resolves chained calls back to commander's API surface", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const apiSurfaces = sites.map((site) => site.apiSurface).sort();
  assert.deepEqual(apiSurfaces, ["Command", "Command.name", "Command.option"]);
  assert.ok(sites.every((site) => site.dependency === "commander"));
});

test("findCallSites returns nothing for a dependency never imported", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "typescript", currentVersion: "7.0.2", type: "direct" },
  ]);

  assert.deepEqual(sites, []);
});

// Regression test for a real bug found scanning got (github.com/sindresorhus/got):
// `type Assert = {...}` is a type alias to an anonymous object literal, not
// an interface/class. The literal's own symbol name is TypeScript's internal
// placeholder "__type" - typeName() must prefer the alias symbol ("Assert")
// instead, or fall back to node text, never surface "__type" itself.
test("findCallSites names a type alias to an anonymous object literal, not '__type'", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-lib", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(
    sites.map((site) => site.apiSurface),
    ["Assert.boolean"],
  );
});
