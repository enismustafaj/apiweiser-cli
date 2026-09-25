// No mocking of the agent CLI itself - config.command points at a real
// `node -e <script>` subprocess standing in for it, same idea as
// changelog-summarizer-agent.test.ts's local HTTP stand-in for an LLM
// provider. The fake agent writes the exact prompt it received to a file
// so the test can inspect it, then reports success.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CodingAgentService } from "../../../src/change-requests/agent/coding-agent-service.ts";
import { CodemodRegistry } from "../../../src/change-requests/registry/codemod-registry.ts";
import type { CallSite } from "../../../src/dependencies/types.ts";

const createdPackageDirs: string[] = [];
const CAPTURE_SCRIPT = `
  require("fs").writeFileSync("prompt-capture.txt", process.argv[process.argv.length - 1]);
  console.log('CODEMOD_RESULT: {"success": true}');
`;

function callSite(apiSurface: string, line: number): CallSite {
  return {
    dependency: "some-pkg",
    file: "src/index.ts",
    line,
    snippet: `${apiSurface.toLowerCase()}(${line})`,
    apiSurface,
  };
}

after(() => {
  for (const dir of createdPackageDirs) rmSync(dir, { recursive: true, force: true });
});

test("buildPrompt samples at most 3 call sites per API surface and says so", async () => {
  const packageName = `test-pkg-${randomUUID()}`;
  createdPackageDirs.push(join(homedir(), ".apiweiser-cli", "codemods", packageName));
  const service = new CodingAgentService({ command: "node", args: ["-e", CAPTURE_SCRIPT] });

  const callSites = [
    ...[1, 2, 3, 4, 5].map((line) => callSite("Foo.bar", line)),
    callSite("Foo.baz", 100),
  ];

  await service.generateCodemod({
    repoPath: "/repos/a",
    packageName,
    version: "1.0.0",
    newVersion: "2.0.0",
    callSites,
    isDevDependency: false,
    summary: "breaking release",
  });

  const codemodPath = new CodemodRegistry().pathFor(packageName, "1.0.0", "2.0.0");
  const prompt = readFileSync(join(codemodPath, "prompt-capture.txt"), "utf8");

  assert.match(prompt, /showing 4 of 6 total, up to 3 per distinct API surface/);
  assert.match(prompt, /foo\.bar\(1\)/);
  assert.match(prompt, /foo\.bar\(2\)/);
  assert.match(prompt, /foo\.bar\(3\)/);
  assert.doesNotMatch(prompt, /foo\.bar\(4\)/);
  assert.doesNotMatch(prompt, /foo\.bar\(5\)/);
  assert.match(prompt, /foo\.baz\(100\)/);
});

test("buildPrompt doesn't truncate or mention sampling when nothing was dropped", async () => {
  const packageName = `test-pkg-${randomUUID()}`;
  createdPackageDirs.push(join(homedir(), ".apiweiser-cli", "codemods", packageName));
  const service = new CodingAgentService({ command: "node", args: ["-e", CAPTURE_SCRIPT] });

  await service.generateCodemod({
    repoPath: "/repos/a",
    packageName,
    version: "1.0.0",
    newVersion: "2.0.0",
    callSites: [callSite("Foo.bar", 1), callSite("Foo.baz", 2)],
    isDevDependency: false,
    summary: "breaking release",
  });

  const codemodPath = new CodemodRegistry().pathFor(packageName, "1.0.0", "2.0.0");
  const prompt = readFileSync(join(codemodPath, "prompt-capture.txt"), "utf8");

  assert.doesNotMatch(prompt, /showing \d+ of \d+ total/);
  assert.match(prompt, /this list may not be exhaustive/);
});

// devDependencies never have call sites (see DependenciesModule.scan) -
// the prompt should hand the agent the changelog summary and tell it to
// inspect the repo itself, not claim a call-site sample that doesn't exist.
test("buildPrompt describes a devDependency upgrade without a call-site sample", async () => {
  const packageName = `test-pkg-${randomUUID()}`;
  createdPackageDirs.push(join(homedir(), ".apiweiser-cli", "codemods", packageName));
  const service = new CodingAgentService({ command: "node", args: ["-e", CAPTURE_SCRIPT] });

  await service.generateCodemod({
    repoPath: "/repos/a",
    packageName,
    version: "1.0.0",
    newVersion: "2.0.0",
    callSites: [],
    isDevDependency: true,
    summary: "breaking release",
  });

  const codemodPath = new CodemodRegistry().pathFor(packageName, "1.0.0", "2.0.0");
  const prompt = readFileSync(join(codemodPath, "prompt-capture.txt"), "utf8");

  assert.match(prompt, /is a devDependency - no call sites were\ntracked/);
  assert.doesNotMatch(prompt, /Call sites to migrate/);
});
