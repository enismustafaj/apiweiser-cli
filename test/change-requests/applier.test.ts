import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodApplier } from "../../src/change-requests/applier.ts";
import type { CodemodApplicationInput, CodemodPackage } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs a matching codemod with repository-relative paths", async () => {
  const repoPath = temporaryDirectory();
  const codemod = codemodPackage(temporaryDirectory());
  let invocation: unknown;
  const applier = new CodemodApplier(async (command, args, cwd, stdin) => {
    invocation = { command, args, cwd, request: JSON.parse(stdin ?? "") };
    return { command, args, exitCode: 0, stdout: "changed 1 file", stderr: "" };
  });

  const result = await applier.apply(codemod, applicationInput(repoPath));

  assert.equal(result.stdout, "changed 1 file");
  assert.deepEqual(invocation, {
    command: process.execPath,
    args: [join(codemod.directory, "transform.mjs")],
    cwd: repoPath,
    request: {
      ...applicationInput(repoPath),
      repoPath,
      packageFile: "package.json",
      callSites: [{ ...applicationInput(repoPath).callSites[0], file: "src/chat.ts" }],
    },
  });
});

test("rejects call-site paths outside the target repository", async () => {
  const repoPath = temporaryDirectory();
  const input = applicationInput(repoPath);
  input.callSites[0] = { ...input.callSites[0], file: join(repoPath, "../secret.ts") };
  const applier = new CodemodApplier(async () => {
    throw new Error("should not run");
  });

  await assert.rejects(applier.apply(codemodPackage(temporaryDirectory()), input), /outside/);
});

test("surfaces a failed codemod process", async () => {
  const repoPath = temporaryDirectory();
  const applier = new CodemodApplier(async (command, args) => ({
    command,
    args,
    exitCode: 2,
    stdout: "",
    stderr: "ambiguous usage",
  }));

  await assert.rejects(
    applier.apply(codemodPackage(temporaryDirectory()), applicationInput(repoPath)),
    /ambiguous usage/,
  );
});

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

function applicationInput(repoPath: string): CodemodApplicationInput {
  return {
    repoPath,
    datasource: "npm",
    packageName: "openai",
    fromVersion: "4.0.0",
    toVersion: "5.0.0",
    packageFile: join(repoPath, "package.json"),
    callSites: [
      {
        dependency: "openai",
        file: join(repoPath, "src/chat.ts"),
        line: 12,
        snippet: "client.chat.completions.create({})",
        apiSurface: "chat.completions.create",
      },
    ],
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-applier-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
