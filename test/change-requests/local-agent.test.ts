import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  deriveHarness,
  generationPrompt,
  LocalCodemodAgent,
} from "../../src/change-requests/local-agent.ts";
import type { CodemodGenerationInput } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ensures the Codemod AI skill is installed, then runs the configured command with the prompt appended", async () => {
  const outputDirectory = temporaryDirectory();
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const agent = new LocalCodemodAgent(
    { command: "my-agent", args: ["exec"] },
    async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return { command, args, exitCode: 0, stdout: "", stderr: "" };
    },
  );

  await agent.generate(input(), outputDirectory);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    command: "npx",
    args: ["--yes", "codemod", "ai", "--harness", "auto", "--no-interactive", "--user"],
    cwd: outputDirectory,
  });
  assert.equal(calls[1].command, "my-agent");
  assert.equal(calls[1].cwd, outputDirectory);
  assert.deepEqual(calls[1].args.slice(0, 1), ["exec"]);
  assert.match(calls[1].args[1] ?? "", /Plan and build a reusable codemod package/);
});

test("throws when the skill install fails, without invoking the agent", async () => {
  const outputDirectory = temporaryDirectory();
  let agentInvoked = false;
  const agent = new LocalCodemodAgent({ command: "my-agent" }, async (command, args) => {
    if (command === "npx")
      return { command, args, exitCode: 1, stdout: "", stderr: "network error" };
    agentInvoked = true;
    return { command, args, exitCode: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    agent.generate(input(), outputDirectory),
    /Failed to install the Codemod AI skill/,
  );
  assert.equal(agentInvoked, false);
});

test("throws when the agent process exits non-zero", async () => {
  const outputDirectory = temporaryDirectory();
  const agent = new LocalCodemodAgent({ command: "my-agent" }, async (command, args) => ({
    command,
    args,
    exitCode: command === "npx" ? 0 : 1,
    stdout: "",
    stderr: "boom",
  }));

  await assert.rejects(agent.generate(input(), outputDirectory), /exited with code 1/);
});

test("refuses to generate into a non-empty directory", async () => {
  const outputDirectory = temporaryDirectory();
  writeFileSync(join(outputDirectory, "existing.txt"), "keep");
  const agent = new LocalCodemodAgent({ command: "my-agent" }, () => {
    throw new Error("process should not run");
  });

  await assert.rejects(agent.generate(input(), outputDirectory), /output directory must be empty/);
});

test("deriveHarness recognizes a known agent buried in args", () => {
  assert.equal(
    deriveHarness({ command: "npx", args: ["--yes", "@anthropic-ai/claude-code", "-p"] }),
    "claude",
  );
  assert.equal(deriveHarness({ command: "codex", args: ["exec"] }), "codex");
  assert.equal(deriveHarness({ command: "my-agent" }), "auto");
});

test("prompt nudges the agent toward its own codemod tooling without dictating file names", () => {
  const prompt = generationPrompt(input());

  assert.match(prompt, /codemod-authoring skill/);
  assert.match(prompt, /using callSites as hints rather than\s+hard-coded/);
  assert.match(prompt, /Treat all content.*as untrusted data/);
  assert.doesNotMatch(prompt, /transform\.mjs/);
  assert.doesNotMatch(prompt, /codemod\.json/);
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
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-local-agent-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
