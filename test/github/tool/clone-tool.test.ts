import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CloneTool } from "../../../src/github/tool/clone-tool.ts";

const FAKE_CONFIG = { token: "fake-token-for-tests" };
const createdDirs: string[] = [];

// Real git repos, not mocked - same reasoning as git-tool.test.ts: a local
// bare repo stands in for a remote, and the GIT_CONFIG_* auth env vars
// clone()/pull() set unconditionally (see git-auth.ts) are harmless
// against a non-HTTP remote (git only applies http.extraHeader over
// HTTP(S) transport).
function bareRepoWithCommit(): string {
  const bareDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-clone-tool-bare-"));
  createdDirs.push(bareDir);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bareDir });

  const seedDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-clone-tool-seed-"));
  createdDirs.push(seedDir);
  execFileSync("git", ["clone", "-q", bareDir, seedDir]);
  writeFileSync(join(seedDir, "file.txt"), "v1");
  execFileSync("git", ["add", "-A"], { cwd: seedDir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"],
    { cwd: seedDir },
  );
  execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: seedDir });

  return bareDir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("clone checks the repo out into destDir", async () => {
  const bareDir = bareRepoWithCommit();
  const destDir = join(tmpdir(), `apiweiser-cli-clone-tool-dest-${Date.now()}`);
  createdDirs.push(destDir);

  await new CloneTool(FAKE_CONFIG).clone(bareDir, destDir);

  assert.ok(existsSync(join(destDir, ".git")));
  assert.equal(readFileSync(join(destDir, "file.txt"), "utf8"), "v1");
});

test("pull brings in commits made after the initial clone", async () => {
  const bareDir = bareRepoWithCommit();
  const destDir = join(tmpdir(), `apiweiser-cli-clone-tool-dest-${Date.now()}`);
  createdDirs.push(destDir);
  await new CloneTool(FAKE_CONFIG).clone(bareDir, destDir);

  // A second clone of the same bare repo pushes a new commit, simulating
  // upstream changing after the first --repo run.
  const secondSeed = mkdtempSync(join(tmpdir(), "apiweiser-cli-clone-tool-seed2-"));
  createdDirs.push(secondSeed);
  execFileSync("git", ["clone", "-q", bareDir, secondSeed]);
  writeFileSync(join(secondSeed, "file.txt"), "v2");
  execFileSync("git", ["add", "-A"], { cwd: secondSeed });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-q", "-m", "update"],
    { cwd: secondSeed },
  );
  execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: secondSeed });

  await new CloneTool(FAKE_CONFIG).pull(destDir);

  assert.equal(readFileSync(join(destDir, "file.txt"), "utf8"), "v2");
});
