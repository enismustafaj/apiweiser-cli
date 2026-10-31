import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Scanner } from "../../../src/dependencies/scanner/scanner.ts";

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/scanner-project", import.meta.url));

test("findCallSites resolves chained calls back to commander's API surface", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "commander", currentVersion: "15.0.0", type: "direct" },
  ]);

  const apiSurfaces = sites.map((site) => site.apiSurface).sort();
  assert.deepEqual(apiSurfaces, ["Command", "Command.name", "Command.option"]);
  assert.ok(sites.every((site) => site.dependency === "commander"));
});

// builtins.ts calls console.log and Array.filter, whose declarations live in
// typescript's lib.*.d.ts - the language, not the typescript package's API.
test("findCallSites credits nothing to typescript for built-in calls", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "typescript", currentVersion: "7.0.2", type: "direct" },
  ]);

  assert.deepEqual(sites, []);
});

test("findCallSites names a type alias to an anonymous object literal, not '__type'", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-lib", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(
    sites.map((site) => site.apiSurface),
    ["Assert.boolean"],
  );
});

// namespace-usage.ts's `untyped.ping()` would otherwise be named after the
// module's quoted file path, leaking an absolute path into the output.
test("findCallSites finds usage of a package typed via a separate @types package", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-untyped-lib", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(sites.map((site) => site.apiSurface).sort(), ["ping", "untyped.ping"]);
});

// Older setups list the @types package as a dependency next to the package
// itself - the calls still belong to the package.
test("findCallSites credits the package, not its @types package, when both are dependencies", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "@types/fake-untyped-lib", currentVersion: "1.0.0", type: "direct" },
    { name: "fake-untyped-lib", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.ok(sites.length > 0);
  assert.ok(sites.every((site) => site.dependency === "fake-untyped-lib"));
});

test("findCallSites credits a helper @types package's methods to the package it extends", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-server", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(sites.map((site) => site.apiSurface).sort(), ["App.use", "server"]);
});

// jsx-usage.tsx renders <div>, <Combobox.Root> and <Button /> - <div> is an
// intrinsic element (declared by @types/react for every app), not fake-ui's.
test("findCallSites finds components used as JSX, skipping intrinsic elements", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-ui", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(sites.map((site) => site.apiSurface).sort(), ["<Button>", "<Combobox.Root>"]);
});

test("findCallSites finds extends, implements and type references", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-base", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(sites.map((site) => site.apiSurface).sort(), [
    "OnInit",
    "extends Component",
    "implements OnInit",
  ]);
});

// require-usage.js: plain JS, require() of an untyped package whose
// module.exports is an object literal (TypeScript calls its type __object).
test("findCallSites resolves require() in plain JS to an untyped package", async () => {
  const sites = await new Scanner().findCallSites(FIXTURE_DIR, [
    { name: "fake-js-lib", currentVersion: "1.0.0", type: "direct" },
  ]);

  assert.deepEqual(
    sites.map((site) => [site.apiSurface, site.file.endsWith("require-usage.js")]),
    [["jwt.sign", true]],
  );
});
