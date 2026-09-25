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

// Real bug, found running the full pipeline against a real yarn-based repo:
// npm install rewrites an existing yarn.lock (dropping resolved hashes,
// swapping registry.yarnpkg.com for registry.npmjs.org) into a shape
// yarn classic's own parser then rejects on the next `yarn add`. Installing
// with whichever manager the repo already committed a lockfile for avoids
// touching the other manager's lockfile at all.
test("install uses yarn, not npm, when the repo has a yarn.lock", async () => {
  const dir = tempRepo();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: "1.0.0" }));
  writeFileSync(join(dir, "yarn.lock"), "");

  await new DependencyInstaller().install(dir);

  assert.equal(existsSync(join(dir, "package-lock.json")), false);
});

test("install is a no-op when there's no package.json", async () => {
  const dir = tempRepo();

  await assert.doesNotReject(() => new DependencyInstaller().install(dir));

  assert.equal(existsSync(join(dir, "package-lock.json")), false);
});

// Real peer conflict, found the hard way on a real dormant repo: mobx-react
// 5.4.4's peer range caps at react@16, but plenty of real repos pinned
// react@17 anyway (worked fine under npm 6, which only warned). Without
// --legacy-peer-deps, npm 7+ rejects this outright.
test("install succeeds despite an unresolvable peer dependency conflict", async () => {
  const dir = tempRepo();
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "x",
      version: "1.0.0",
      dependencies: { react: "17.0.1", "mobx-react": "5.4.4" },
    }),
  );

  await assert.doesNotReject(() => new DependencyInstaller().install(dir));

  assert.ok(existsSync(join(dir, "node_modules", "react")));
});
