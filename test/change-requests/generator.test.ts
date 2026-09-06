import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodGenerator } from "../../src/change-requests/generator.ts";
import { CodemodRegistry } from "../../src/change-requests/registry.ts";
import type { CodemodAgent, CodemodGenerationInput } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generates, tests, and stores a package that is not in the registry", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const agent = new FakeAgent();
  const tested: string[] = [];
  const generator = new CodemodGenerator(agent, registry, async (directory, testFile) => {
    tested.push(join(directory, testFile));
  });

  const result = await generator.resolve(input());

  assert.equal(result.reused, false);
  assert.equal(agent.calls, 1);
  assert.equal(tested.length, 1);
  assert.equal(result.codemod.manifest.packageName, "openai");
  assert.deepEqual(registry.find(input()), result.codemod);
});

test("reuses a stored package without invoking the agent or tests", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const agent = new FakeAgent();
  const generator = new CodemodGenerator(agent, registry, async () => {});
  const first = await generator.resolve(input());

  const second = await generator.resolve(input());

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(agent.calls, 1);
  assert.equal(second.codemod.directory, first.codemod.directory);
});

test("does not store a generated package when its test fails", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const generator = new CodemodGenerator(new FakeAgent(), registry, async () => {
    throw new Error("generated test failed");
  });

  await assert.rejects(generator.resolve(input()), /generated test failed/);
  assert.equal(registry.find(input()), null);
});

test("rejects a package generated for a different upgrade", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const generator = new CodemodGenerator(
    new FakeAgent({ toVersion: "6.0.0" }),
    registry,
    async () => {},
  );

  await assert.rejects(generator.resolve(input()), /does not match its registry identity/);
  assert.equal(registry.find(input()), null);
});

class FakeAgent implements CodemodAgent {
  calls = 0;
  private readonly manifestOverrides: Record<string, unknown>;

  constructor(manifestOverrides: Record<string, unknown> = {}) {
    this.manifestOverrides = manifestOverrides;
  }

  async generate(input: CodemodGenerationInput, outputDirectory: string): Promise<void> {
    this.calls += 1;
    writeFileSync(
      join(outputDirectory, "codemod.json"),
      JSON.stringify({
        schemaVersion: 1,
        datasource: input.datasource,
        packageName: input.packageName,
        fromVersion: input.fromVersion,
        toVersion: input.toVersion,
        summary: "Migrate the API",
        runtime: "node",
        entrypoint: "transform.mjs",
        testEntrypoint: "transform.test.mjs",
        ...this.manifestOverrides,
      }),
    );
    writeFileSync(join(outputDirectory, "transform.mjs"), "// transform");
    writeFileSync(join(outputDirectory, "transform.test.mjs"), "// test");
  }
}

function input(): CodemodGenerationInput {
  return {
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    packageFile: "package.json",
    changelog: "Responses API replaces chat completions",
    callSites: [],
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-generator-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
