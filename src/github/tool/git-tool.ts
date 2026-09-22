// Cloning a repo in the first place is CloneTool's job, not this one's.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GithubConfig } from "../../config/config.ts";
import type { GitHubRemote } from "../types.ts";
import { gitAuthEnv } from "./git-auth.ts";

const execFileAsync = promisify(execFile);

export class GitTool {
  private readonly token: string;

  constructor(config: GithubConfig) {
    this.token = config.token;
  }

  async hasChanges(repoPath: string): Promise<boolean> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoPath });
    return stdout.trim().length > 0;
  }

  async createBranch(repoPath: string, branch: string): Promise<void> {
    await execFileAsync("git", ["checkout", "-b", branch], { cwd: repoPath });
  }

  async commitAll(repoPath: string, message: string): Promise<void> {
    await execFileAsync("git", ["add", "-A"], { cwd: repoPath });
    await execFileAsync("git", ["commit", "-m", message], { cwd: repoPath });
  }

  async push(repoPath: string, branch: string): Promise<void> {
    await execFileAsync("git", ["push", "-u", "origin", branch], {
      cwd: repoPath,
      env: gitAuthEnv(this.token),
    });
  }

  // A repo cloned once and reused across runs (see RepoCloner) can be left
  // checked out on a feature branch from a previous PR attempt - pulling
  // without resetting first would pull *that* branch, not the default one,
  // and a later codemod would run against already-modified code instead
  // of a clean checkout. Discards any local changes/branches; this cache
  // is disposable, never a place to keep work.
  async resetToDefaultBranch(repoPath: string): Promise<void> {
    const branch = await this.defaultBranch(repoPath);
    await execFileAsync("git", ["checkout", branch], { cwd: repoPath });
    await execFileAsync("git", ["reset", "--hard", `origin/${branch}`], { cwd: repoPath });
    await execFileAsync("git", ["clean", "-fd"], { cwd: repoPath });
  }

  // Falls back to "main" if there's no tracked origin/HEAD ref.
  async defaultBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
        { cwd: repoPath },
      );
      return stdout.trim().replace(/^origin\//, "");
    } catch {
      return "main";
    }
  }

  async remoteRepo(repoPath: string): Promise<GitHubRemote | null> {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
    });
    return this.parseGitHubRemote(stdout.trim());
  }

  private parseGitHubRemote(url: string): GitHubRemote | null {
    const cleaned = url
      .replace(/^git\+/, "")
      .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/\.git$/, "");

    const match = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);
    return match ? { owner: match[1]!, repo: match[2]! } : null;
  }
}
