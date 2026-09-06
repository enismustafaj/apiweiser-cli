import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { ChangeRequestsModule } from "../../src/change-requests/index.ts";
import type {
  ChangeRequestInput,
  CodemodApplicationInput,
  CodemodGenerationInput,
  CodemodPackage,
} from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generates or reuses, applies, then verifies a change request", async () => {
  const repoPath = temporaryDirectory();
  const codemod = codemodPackage(temporaryDirectory());
  const events: string[] = [];
  let generationInput: CodemodGenerationInput | undefined;
  let applicationInput: CodemodApplicationInput | undefined;
  const module = new ChangeRequestsModule({
    generator: {
      async resolve(input) {
        events.push("generate");
        generationInput = input;
        return { codemod, reused: true };
      },
    },
    applier: {
      async apply(_codemod, input) {
        events.push("apply");
        applicationInput = input;
        return {
          command: "node",
          args: ["transform.mjs"],
          exitCode: 0,
          stdout: "changed",
          stderr: "",
        };
      },
    },
    verifier: {
      async verify(path, commands) {
        events.push("verify");
        assert.equal(path, repoPath);
        assert.deepEqual(commands, [{ command: "npm", args: ["test"] }]);
        return [
          {
            command: "npm",
            args: ["test"],
            exitCode: 0,
            stdout: "passed",
            stderr: "",
          },
        ];
      },
    },
  });

  const result = await module.create(input(repoPath));

  assert.deepEqual(events, ["generate", "apply", "verify"]);
  assert.equal(result.reusedCodemod, true);
  assert.deepEqual(generationInput, {
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    packageFile: "package.json",
    changelog: "Responses API replaces chat completions",
    callSites: [{ ...input(repoPath).callSites[0], file: "src/chat.ts" }],
  });
  assert.deepEqual(applicationInput, {
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    repoPath,
    packageFile: "package.json",
    callSites: [{ ...input(repoPath).callSites[0], file: "src/chat.ts" }],
  });
});

function input(repoPath: string): ChangeRequestInput {
  return {
    repoPath,
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    packageFile: join(repoPath, "package.json"),
    changelog: "Responses API replaces chat completions",
    callSites: [
      {
        dependency: "openai",
        file: join(repoPath, "src/chat.ts"),
        line: 12,
        snippet: "client.chat.completions.create({})",
        apiSurface: "chat.completions.create",
      },
    ],
    verificationCommands: [{ command: "npm", args: ["test"] }],
  };
}

function codemodPackage(directory: string): CodemodPackage {
  return {
    id: "codemod-id",
    directory,
    manifest: {
      schemaVersion: 1,
      datasource: "npm",
      packageName: "openai",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
      summary: "Migrate API",
      runtime: "node",
      entrypoint: "transform.mjs",
      testEntrypoint: "transform.test.mjs",
    },
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-change-request-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
