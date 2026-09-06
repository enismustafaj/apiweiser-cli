// Thin wrapper over the `git` CLI for the branch/commit/push steps of
// opening a change-request PR. Only `push` needs remote auth - authenticated
// the same way as PullRequestService, with the same `github.token` (a PAT),
// so there's no separate assumption that `git` already has its own push
// credentials configured for whatever repo `--path` points at.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GithubConfig } from "../../config/config.ts";
import type { GitHubRemote } from "../types.ts";

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

  // Auth via `http.extraHeader`, same PAT as PullRequestService (Basic with
  // the `x-access-token` username - GitHub's documented way to use a PAT
  // over HTTPS git, works for both classic and fine-grained tokens). Passed
  // through GIT_CONFIG_KEY_0/VALUE_0 env vars rather than `-c` on the
  // command line - argv is visible to any other process on the machine via
  // `ps`, env vars aren't (barring another process on the same machine
  // reading /proc/<pid>/environ as the same user). A no-op if `origin` is
  // an SSH remote - git only applies http.extraHeader to HTTP(S) transport.
  async push(repoPath: string, branch: string): Promise<void> {
    await execFileAsync("git", ["push", "-u", "origin", branch], {
      cwd: repoPath,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: this.authHeader(),
      },
    });
  }

  private authHeader(): string {
    const encoded = Buffer.from(`x-access-token:${this.token}`).toString("base64");
    return `AUTHORIZATION: basic ${encoded}`;
  }

  // Falls back to "main" when there's no tracked origin/HEAD (e.g. a fresh
  // clone with `--single-branch`) - a reasonable default, not a guess at
  // the actual branch name of every possible repo.
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

  // Same normalization idea as NpmRegistryLookup.extractGitHubRepo - a
  // different source format (a git remote URL, not npm's `repository`
  // field) but the same handful of shapes (git+https, git@host:, ssh://).
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
