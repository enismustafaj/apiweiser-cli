import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodRegistry, codemodId } from "../../src/change-requests/registry.ts";
import type { CodemodPackageManifest } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stores and finds a reusable codemod package", () => {
  const registryDirectory = temporaryDirectory("registry");
  const generatedDirectory = generatedPackage();
  const registry = new CodemodRegistry(registryDirectory);

  const stored = registry.store(generatedDirectory);
  const found = registry.find(stored.manifest);

  assert.equal(
    stored.id,
    codemodId({
      datasource: "npm",
      packageName: "openai",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
    }),
  );
  assert.deepEqual(found, stored);
  assert.equal(readFileSync(join(stored.directory, "transform.mjs"), "utf8"), "// transform");
});

test("does not overwrite an existing package with the same identity", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const first = generatedPackage("// first");
  const second = generatedPackage("// second");

  const stored = registry.store(first);
  const reused = registry.store(second);

  assert.equal(reused.directory, stored.directory);
  assert.equal(readFileSync(join(reused.directory, "transform.mjs"), "utf8"), "// first");
});

test("rejects a non-standard package entrypoint", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const generatedDirectory = generatedPackage();
  const manifest = manifestFor({ entrypoint: "../transform.mjs" });
  writeFileSync(join(generatedDirectory, "codemod.json"), JSON.stringify(manifest));

  assert.throws(() => registry.store(generatedDirectory), /Invalid codemod.json/);
});

test("rejects a package whose required files are missing", () => {
  const registry = new CodemodRegistry(temporaryDirectory("registry"));
  const generatedDirectory = temporaryDirectory("generated");
  writeFileSync(join(generatedDirectory, "codemod.json"), JSON.stringify(manifestFor()));

  assert.throws(() => registry.store(generatedDirectory), /does not exist/);
});

function generatedPackage(transform = "// transform"): string {
  const directory = temporaryDirectory("generated");
  writeFileSync(join(directory, "codemod.json"), JSON.stringify(manifestFor()));
  writeFileSync(join(directory, "transform.mjs"), transform);
  writeFileSync(join(directory, "transform.test.mjs"), "// test");
  return directory;
}

function manifestFor(overrides: Partial<CodemodPackageManifest> = {}): CodemodPackageManifest {
  return {
    schemaVersion: 1,
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    summary: "Migrate removed API calls",
    runtime: "node",
    entrypoint: "transform.mjs",
    testEntrypoint: "transform.test.mjs",
    ...overrides,
  };
}

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `apiweiser-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}
