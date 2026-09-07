import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CodemodRegistry } from "../../../src/change-requests/registry/codemod-registry.ts";

const createdDirs: string[] = [];

function registry(): CodemodRegistry {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-codemod-registry-test-"));
  createdDirs.push(dir);
  return new CodemodRegistry(dir);
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("pathFor creates and returns a directory keyed by package name and version pair", () => {
  const path = registry().pathFor("commander", "15.0.0", "16.0.0");

  assert.ok(existsSync(path));
  assert.match(path, /commander[/\\]15\.0\.0_to_16\.0\.0$/);
});

test("pathFor sanitizes path separators in its arguments", () => {
  const path = registry().pathFor("@scope/pkg", "1.0.0", "2.0.0");

  assert.ok(existsSync(path));
  assert.match(path, /@scope_pkg/);
});

test("has is false when no codemod.yaml was ever written", () => {
  const reg = registry();
  reg.pathFor("commander", "15.0.0", "16.0.0");

  assert.equal(reg.has("commander", "15.0.0", "16.0.0"), false);
});

test("has is true once codemod.yaml exists in that entry's directory", () => {
  const reg = registry();
  const path = reg.pathFor("commander", "15.0.0", "16.0.0");
  writeFileSync(join(path, "codemod.yaml"), "name: commander-15-to-16\n");

  assert.equal(reg.has("commander", "15.0.0", "16.0.0"), true);
});
