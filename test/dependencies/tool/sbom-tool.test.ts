import assert from "node:assert/strict";
import { test } from "node:test";
import { SbomTool } from "../../../src/dependencies/tool/sbom-tool.ts";

// Runs the real `npm sbom` subprocess against this repo (fast, local, no
// network - unlike RenovateTool, which isn't covered by an automated test
// for that reason, see docs/suggestions.md). Also writes to the real
// ~/.apiweiser-cli/sbom cache, same as a normal run.
test("generate reports this repo's own direct dependencies", async () => {
  const dependencies = await new SbomTool().generate(".");

  const commander = dependencies.find((dependency) => dependency.name === "commander");
  assert.ok(commander, "expected commander in this repo's own dependencies");
  assert.equal(commander?.type, "direct");
});

// npm sbom marks a devDependency with a `cdx:npm:package:development`
// property, not a distinct `scope` value - typescript is a real
// devDependency of this repo itself, so no fixture needed.
test("generate flags a devDependency via isDevDependency", async () => {
  const dependencies = await new SbomTool().generate(".");

  const commander = dependencies.find((dependency) => dependency.name === "commander");
  const typescript = dependencies.find((dependency) => dependency.name === "typescript");
  assert.equal(commander?.isDevDependency, false);
  assert.equal(typescript?.isDevDependency, true);
});
