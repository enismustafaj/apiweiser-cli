import assert from "node:assert/strict";
import { test } from "node:test";
import { registryKeyFor } from "../../src/change-requests/registry-key.ts";
import { CodemodRegistry } from "../../src/change-requests/registry/codemod-registry.ts";

// Found running against a real repo: "@base-ui/react" + "date-fns" was
// keyed as "@base-ui/1_to_4" - date-fns dropped from the label, and the
// two packages' versions mixed into one range neither actually spans.
test("registryKeyFor keeps every package and its own versions for a mixed-scope group", () => {
  const key = registryKeyFor([
    { name: "date-fns", version: "3.6.0", newVersion: "4.4.0" },
    { name: "@base-ui/react", version: "1.3.0", newVersion: "1.9.0" },
  ]);

  assert.deepEqual(key, {
    label: "@base-ui/react+date-fns",
    fromVersion: "1.3.0+3.6.0",
    toVersion: "1.9.0+4.4.0",
  });

  const registry = new CodemodRegistry("/registry");
  assert.equal(
    registry.dirFor(key.label, key.fromVersion, key.toVersion),
    "/registry/@base-ui_react+date-fns/1.3.0_to_1.9.0+3_to_4",
  );
  assert.equal(
    registry.remoteName(key.label, key.fromVersion, key.toVersion),
    "base-ui_react--date-fns-1.3.0-to-1.9.0--3-to-4",
  );
});

test("registryKeyFor labels a shared-scope group with the scope and its widest version range", () => {
  const key = registryKeyFor([
    { name: "@angular/core", version: "5.0.0", newVersion: "20.0.0" },
    { name: "@angular/router", version: "5.0.0", newVersion: "22.0.0" },
  ]);

  assert.deepEqual(key, { label: "@angular", fromVersion: "5.0.0", toVersion: "22.0.0" });
});
