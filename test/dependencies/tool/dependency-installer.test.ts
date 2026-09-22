// Runs the real `npm install` subprocess (fast, local, no real deps to
// fetch) - same reasoning as SbomTool's test running the real `npm sbom`
// subprocess.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DependencyInstaller } from "../../../src/dependencies/tool/dependency-installer.ts";

const createdDirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-dependency-installer-test-"));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("install runs npm install when the repo has a package.json", async () => {
  const dir = tempRepo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));

  await new DependencyInstaller().install(dir);

  assert.ok(existsSync(join(dir, "package-lock.json")));
});

test("install is a no-op when there's no package.json", async () => {
  const dir = tempRepo();

  await assert.doesNotReject(() => new DependencyInstaller().install(dir));

  assert.equal(existsSync(join(dir, "package-lock.json")), false);
});
