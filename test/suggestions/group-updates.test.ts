import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeByPackage, groupByScope } from "../../src/suggestions/group-updates.ts";
import type { RenovateUpdate } from "../../src/suggestions/types.ts";

function update(dependency: string, currentVersion: string, newVersion: string): RenovateUpdate {
  return {
    dependency,
    packageFile: "package.json",
    depType: "dependencies",
    currentVersion,
    newVersion,
    updateType: "major",
    datasource: "npm",
  };
}

test("groupByScope bundles scope-siblings into one group", () => {
  const updates = [
    update("@angular/core", "5.2.9", "20.0.0"),
    update("@angular/router", "5.2.9", "22.2.0"),
    update("commander", "10.0.0", "15.0.0"),
  ];

  const groups = groupByScope(updates);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.find((g) => g.length === 2)!.map((u) => u.dependency),
    ["@angular/core", "@angular/router"],
  );
  assert.deepEqual(
    groups.find((g) => g.length === 1)!.map((u) => u.dependency),
    ["commander"],
  );
});

test("groupByScope never bundles @types/* packages together", () => {
  const updates = [
    update("@types/react", "17.0.0", "19.0.0"),
    update("@types/node", "14.0.0", "22.0.0"),
  ];

  const groups = groupByScope(updates);

  assert.equal(groups.length, 2);
});

// Real bug, found running the full pipeline against a real repo: Renovate
// proposed both "@angular/forms"@5.2.9->5.2.11 (patch) and
// @5.2.9->22.2.0 (major) as separate suggestion rows. Without dedupeByPackage,
// both landed in the same group, producing `npm install @angular/forms@5.2.11
// @angular/forms@22.2.0` in one command - npm can't resolve two specs for the
// same package.
test("dedupeByPackage keeps only the highest new version for a package proposed twice", () => {
  const group = [
    update("@angular/forms", "5.2.9", "5.2.11"),
    update("@angular/forms", "5.2.9", "22.2.0"),
    update("@angular/core", "5.2.9", "20.0.0"),
  ];

  const deduped = dedupeByPackage(group);

  assert.equal(deduped.length, 2);
  const forms = deduped.find((u) => u.dependency === "@angular/forms");
  assert.equal(forms?.newVersion, "22.2.0");
});
