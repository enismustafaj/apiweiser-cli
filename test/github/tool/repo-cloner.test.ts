import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { RepoCloner } from "../../../src/github/tool/repo-cloner.ts";

const FAKE_CONFIG = { token: "fake-token-for-tests" };
const createdDirs: string[] = [];
const REAL_CACHE_DIR = join(homedir(), ".apiweiser-cli", "repos");

function bareRepoWithCommit(content: string): string {
  const bareDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-repo-cloner-bare-"));
  createdDirs.push(bareDir);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bareDir });

  const seedDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-repo-cloner-seed-"));
  createdDirs.push(seedDir);
  execFileSync("git", ["clone", "-q", bareDir, seedDir]);
  writeFileSync(join(seedDir, "file.txt"), content);
  execFileSync("git", ["add", "-A"], { cwd: seedDir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-q", "-m", "init"],
    { cwd: seedDir },
  );
  execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: seedDir });

  return bareDir;
}

// cloneOrPull always clones into the real ~/.apiweiser-cli/repos cache
// (same reasoning as SbomTool/RenovateTool's caches - not injectable, so
// these tests clean up their own owner/repo-shaped entry afterward rather
// than pointing at a fake cache dir).
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("cloneOrPull clones into owner-repo under the cache dir, keyed by URL shape", async () => {
  const bareDir = bareRepoWithCommit("v1");
  // A plain tmpdir path has no "owner/repo" shape, so re-clone the bare
  // repo one level deeper, under a directory structure that does.
  const ownerDir = join(tmpdir(), `apiweiser-cli-repo-cloner-remote-${Date.now()}`);
  mkdirSync(join(ownerDir, "some-owner"), { recursive: true });
  execFileSync("git", [
    "clone",
    "--bare",
    "-q",
    bareDir,
    join(ownerDir, "some-owner", "some-repo.git"),
  ]);
  createdDirs.push(ownerDir);

  const destDir = await new RepoCloner(FAKE_CONFIG).cloneOrPull(
    join(ownerDir, "some-owner", "some-repo.git"),
  );

  assert.equal(destDir, join(REAL_CACHE_DIR, "some-owner-some-repo"));
  assert.ok(existsSync(join(destDir, ".git")));
  assert.equal(readFileSync(join(destDir, "file.txt"), "utf8"), "v1");

  rmSync(destDir, { recursive: true, force: true });
});

test("cloneOrPull pulls instead of re-cloning on a second call for the same URL", async () => {
  const bareDir = bareRepoWithCommit("v1");
  const ownerDir = join(tmpdir(), `apiweiser-cli-repo-cloner-remote-${Date.now()}`);
  mkdirSync(join(ownerDir, "another-owner"), { recursive: true });
  const remoteUrl = join(ownerDir, "another-owner", "another-repo.git");
  execFileSync("git", ["clone", "--bare", "-q", bareDir, remoteUrl]);
  createdDirs.push(ownerDir);

  const cloner = new RepoCloner(FAKE_CONFIG);
  const first = await cloner.cloneOrPull(remoteUrl);

  // Push a new commit to the "remote" the same way a second run would see
  // upstream changes.
  const seedDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-repo-cloner-seed2-"));
  createdDirs.push(seedDir);
  execFileSync("git", ["clone", "-q", remoteUrl, seedDir]);
  writeFileSync(join(seedDir, "file.txt"), "v2");
  execFileSync("git", ["add", "-A"], { cwd: seedDir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-q", "-m", "update"],
    { cwd: seedDir },
  );
  execFileSync("git", ["push", "-q", "origin", "HEAD"], { cwd: seedDir });

  const second = await cloner.cloneOrPull(remoteUrl);

  assert.equal(second, first);
  assert.equal(readFileSync(join(second, "file.txt"), "utf8"), "v2");

  rmSync(second, { recursive: true, force: true });
});

// Reproduces the real bug: GithubModule leaves the local clone checked out
// on a PR feature branch (GitTool.createBranch/commitAll never switch back)
// - a naive `git pull` on the next run would pull *that* branch instead of
// the default one, and a later codemod would run against already-modified
// code instead of a clean checkout.
test("cloneOrPull resets a clone left on a feature branch back to the default branch", async () => {
  const bareDir = bareRepoWithCommit("v1");
  const ownerDir = join(tmpdir(), `apiweiser-cli-repo-cloner-remote-${Date.now()}`);
  mkdirSync(join(ownerDir, "feature-owner"), { recursive: true });
  const remoteUrl = join(ownerDir, "feature-owner", "feature-repo.git");
  execFileSync("git", ["clone", "--bare", "-q", bareDir, remoteUrl]);
  createdDirs.push(ownerDir);

  const cloner = new RepoCloner(FAKE_CONFIG);
  const destDir = await cloner.cloneOrPull(remoteUrl);

  // Simulate what a previous change-request run leaves behind: a checked
  // out, committed feature branch, same as GitTool.createBranch/commitAll.
  execFileSync("git", ["checkout", "-q", "-b", "apiweiser-cli/some-pkg-2.0.0"], { cwd: destDir });
  writeFileSync(join(destDir, "codemod-output.txt"), "migrated");
  execFileSync("git", ["add", "-A"], { cwd: destDir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-q", "-m", "migrate"],
    { cwd: destDir },
  );

  const second = await cloner.cloneOrPull(remoteUrl);

  assert.equal(second, destDir);
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], { cwd: second }).toString().trim(),
    "main",
  );
  assert.equal(existsSync(join(second, "codemod-output.txt")), false);
  assert.equal(readFileSync(join(second, "file.txt"), "utf8"), "v1");

  rmSync(second, { recursive: true, force: true });
});
