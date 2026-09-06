import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodRegistry, codemodId } from "../../src/change-requests/registry.ts";
import type { CodemodIdentity } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores and finds a reusable codemod package", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const generatedDirectory = generatedPackage();

  const stored = registry.store(identity(), generatedDirectory, "Migrate removed API calls");
  const found = registry.find(identity(), "Migrate removed API calls");

  assert.equal(stored.id, codemodId(identity()));
  assert.deepEqual(stored.manifest, { ...identity(), summary: "Migrate removed API calls" });
  assert.deepEqual(found, stored);
  assert.equal(readFileSync(join(stored.directory, "transform.mjs"), "utf8"), "// transform");
});

test("find returns null for an identity that hasn't been stored", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));

  assert.equal(registry.find(identity(), "summary"), null);
});

test("does not overwrite an existing package with the same identity", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const first = generatedPackage("// first");
  const second = generatedPackage("// second");

  const stored = registry.store(identity(), first, "first summary");
  const reused = registry.store(identity(), second, "second summary");

  assert.equal(reused.directory, stored.directory);
  assert.equal(readFileSync(join(reused.directory, "transform.mjs"), "utf8"), "// first");
});

test("different identities get different registry directories", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const other = { ...identity(), toVersion: "6.0.0" };

  const stored = registry.store(identity(), generatedPackage(), "summary");
  const storedOther = registry.store(other, generatedPackage(), "summary");

  assert.notEqual(stored.directory, storedOther.directory);
});

function generatedPackage(transform = "// transform"): string {
  const directory = temporaryDirectory("generated");
  writeFileSync(join(directory, "transform.mjs"), transform);
  return directory;
}

function identity(): CodemodIdentity {
  return { datasource: "npm", packageName: "openai", fromVersion: "4.0.0", toVersion: "5.0.0" };
}

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `apiweiser-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}
