import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { after, test } from "node:test";
import { GitTool } from "../../../src/github/tool/git-tool.ts";

const FAKE_CONFIG = { token: "fake-token-for-tests" };
const createdDirs: string[] = [];

// Real git repos, not mocked - remoteRepo()/defaultBranch()/push() shell
// out to the real `git` CLI, same reasoning as SbomTool's test running the
// real `npm sbom` subprocess.
function repoWithRemote(remoteUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-git-tool-test-"));
  createdDirs.push(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: dir });
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("remoteRepo resolves a https github remote", async () => {
  const dir = repoWithRemote("https://github.com/owner/repo.git");

  const remote = await new GitTool(FAKE_CONFIG).remoteRepo(dir);

  assert.deepEqual(remote, { owner: "owner", repo: "repo" });
});

test("remoteRepo resolves a git@ scp-style remote", async () => {
  const dir = repoWithRemote("git@github.com:owner/repo.git");

  const remote = await new GitTool(FAKE_CONFIG).remoteRepo(dir);

  assert.deepEqual(remote, { owner: "owner", repo: "repo" });
});

test("remoteRepo returns null for a non-GitHub remote", async () => {
  const dir = repoWithRemote("https://gitlab.com/owner/repo.git");

  const remote = await new GitTool(FAKE_CONFIG).remoteRepo(dir);

  assert.equal(remote, null);
});

test('defaultBranch falls back to "main" when there\'s no origin/HEAD ref', async () => {
  const dir = repoWithRemote("https://github.com/owner/repo.git");

  const branch = await new GitTool(FAKE_CONFIG).defaultBranch(dir);

  assert.equal(branch, "main");
});

test("hasChanges is false for a clean repo and true once a file is added", async () => {
  const dir = repoWithRemote("https://github.com/owner/repo.git");
  const git = new GitTool(FAKE_CONFIG);

  assert.equal(await git.hasChanges(dir), false);

  execFileSync("touch", ["untracked.txt"], { cwd: dir });

  assert.equal(await git.hasChanges(dir), true);
});

// push() sets GIT_CONFIG_* env vars unconditionally to carry the auth
// header (see git-tool.ts) - a local, non-HTTP remote ignores them
// entirely (git only applies http.extraHeader over HTTP(S) transport), so
// this exercises the real push path without needing a fake HTTPS server,
// and confirms those extra env vars don't break a normal push.
test("push sends the branch to a local bare remote", async () => {
  const bareDir = mkdtempSync(join(tmpdir(), "apiweiser-cli-git-tool-bare-test-"));
  createdDirs.push(bareDir);
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bareDir });

  const dir = repoWithRemote(bareDir);
  writeFileSync(join(dir, "file.txt"), "content");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=test@test.com", "-c", "user.name=Test", "commit", "-m", "init"],
    {
      cwd: dir,
    },
  );
  execFileSync("git", ["checkout", "-b", "feature-branch"], { cwd: dir });

  await new GitTool(FAKE_CONFIG).push(dir, "feature-branch");

  const branches = execFileSync("git", ["branch"], { cwd: bareDir }).toString();
  assert.match(branches, /feature-branch/);
});
