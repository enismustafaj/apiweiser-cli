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
