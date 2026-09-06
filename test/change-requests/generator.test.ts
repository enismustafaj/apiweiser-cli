import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodGenerator } from "../../src/change-requests/generator.ts";
import { CodemodRegistry } from "../../src/change-requests/registry.ts";
import type { CodemodAgent, CodemodGenerationInput } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];
const noop = async () => {};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generates, validates, tests, and stores a package that is not in the registry", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const agent = new FakeAgent();
  const generator = new CodemodGenerator(agent, registry, noop, noop);

  const result = await generator.resolve(input());

  assert.equal(result.reused, false);
  assert.equal(agent.calls, 1);
  // Only the four identity fields plus summary - not the extra fields
  // (changelog, packageFile, callSites) that also live on `input`.
  assert.deepEqual(result.codemod.manifest, {
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    summary: input().changelog,
  });
});

test("reuses a stored package without invoking the agent, validator, or tests", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const agent = new FakeAgent();
  const generator = new CodemodGenerator(agent, registry, noop, noop);
  const first = await generator.resolve(input());

  const second = await generator.resolve(input());

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(agent.calls, 1);
  assert.equal(second.codemod.directory, first.codemod.directory);
});

test("does not store a generated package that fails validation", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const generator = new CodemodGenerator(
    new FakeAgent(),
    registry,
    async () => {
      throw new Error("package is not ready");
    },
    noop,
  );

  await assert.rejects(generator.resolve(input()), /package is not ready/);
  assert.equal(registry.find(input(), input().changelog), null);
});

test("does not store a generated package when its test fails", async () => {
  const registry = new CodemodRegistry(temporaryDirectory());
  const generator = new CodemodGenerator(new FakeAgent(), registry, noop, async () => {
    throw new Error("generated test failed");
  });

  await assert.rejects(generator.resolve(input()), /generated test failed/);
  assert.equal(registry.find(input(), input().changelog), null);
});

class FakeAgent implements CodemodAgent {
  calls = 0;

  async generate(_input: CodemodGenerationInput, outputDirectory: string): Promise<void> {
    this.calls += 1;
    writeFileSync(join(outputDirectory, "workflow.yaml"), "# a real agent's codemod package");
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
