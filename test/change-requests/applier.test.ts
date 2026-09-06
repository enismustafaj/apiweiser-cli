import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { CodemodApplier } from "../../src/change-requests/applier.ts";
import type { CodemodPackage } from "../../src/change-requests/types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runs the codemod's workflow against the target repository", async () => {
  const repoPath = temporaryDirectory();
  const codemod = codemodPackage(temporaryDirectory());
  let invocation: unknown;
  const applier = new CodemodApplier(async (command, args, cwd) => {
    invocation = { command, args, cwd };
    return { command, args, exitCode: 0, stdout: "changed 1 file", stderr: "" };
  });

  const result = await applier.apply(codemod, { repoPath });

  assert.equal(result.stdout, "changed 1 file");
  assert.deepEqual(invocation, {
    command: "npx",
    args: [
      "--yes",
      "codemod",
      "workflow",
      "run",
      "--workflow",
      codemod.directory,
      "--target",
      repoPath,
      "--no-interactive",
      "--allow-fs",
      "--allow-child-process",
    ],
    cwd: repoPath,
  });
});

test("rejects a repository directory that does not exist", async () => {
  const codemod = codemodPackage(temporaryDirectory());
  const applier = new CodemodApplier(async () => {
    throw new Error("should not run");
  });

  await assert.rejects(
    applier.apply(codemod, { repoPath: join(temporaryDirectory(), "missing") }),
    /does not exist/,
  );
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
    applier.apply(codemodPackage(temporaryDirectory()), { repoPath }),
    /ambiguous usage/,
  );
});

function codemodPackage(directory: string): CodemodPackage {
  return {
    id: "codemod-id",
    directory,
    manifest: {
      datasource: "npm",
      packageName: "openai",
      fromVersion: "4.0.0",
      toVersion: "5.0.0",
      summary: "Migrate API",
    },
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "apiweiser-applier-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
