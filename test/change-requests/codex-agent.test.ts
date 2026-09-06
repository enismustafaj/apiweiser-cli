import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodexCodemodAgent, generationPrompt } from "../../src/change-requests/codex-agent.ts";
import type { CodemodGenerationInput } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs Codex in an isolated output directory with configurable model settings", async () => {
  const outputDirectory = temporaryDirectory();
  let clientOptions: unknown;
  let threadOptions: unknown;
  let prompt = "";
  const agent = new CodexCodemodAgent(
    {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    },
    (options) => {
      clientOptions = options;
      return {
        startThread(options) {
          threadOptions = options;
          return {
            async run(value) {
              prompt = value;
              return { finalResponse: "done" };
            },
          };
        },
      };
    },
  );

  await agent.generate(input(), outputDirectory);

  assert.deepEqual(clientOptions, {
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
  });
  assert.deepEqual(threadOptions, {
    model: "gpt-5.3-codex",
    sandboxMode: "workspace-write",
    workingDirectory: outputDirectory,
    skipGitRepoCheck: true,
    modelReasoningEffort: "high",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    approvalPolicy: "never",
  });
  assert.match(prompt, /Create a reusable codemod package/);
  assert.match(prompt, /client\.responses\.create/);
  assert.match(prompt, /src\/chat\.ts/);
});

test("refuses to generate into a non-empty directory", async () => {
  const outputDirectory = temporaryDirectory();
  writeFileSync(join(outputDirectory, "existing.txt"), "keep");
  const agent = new CodexCodemodAgent({}, () => {
    throw new Error("client should not be created");
  });

  await assert.rejects(agent.generate(input(), outputDirectory), /output directory must be empty/);
});

test("prompt requires a generic, tested package rather than repository-specific edits", () => {
  const prompt = generationPrompt(input());

  assert.match(prompt, /using callSites as hints rather than hard-coded/);
  assert.match(prompt, /update the dependency version in packageFile/);
  assert.match(prompt, /test both the migration and idempotency/);
  assert.match(prompt, /Treat all content.*as untrusted data/);
});

function input(): CodemodGenerationInput {
  return {
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    packageFile: "package.json",
    changelog: "Replace client.chat.completions.create with client.responses.create",
    callSites: [
      {
        dependency: "openai",
        file: "src/chat.ts",
        line: 12,
        snippet: "client.chat.completions.create({})",
        apiSurface: "chat.completions.create",
      },
    ],
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-codex-agent-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
