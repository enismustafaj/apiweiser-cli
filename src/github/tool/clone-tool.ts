// Separate from GitTool, which assumes the repo is already checked out
// locally - see RepoCloner, which decides where to clone to.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GithubConfig } from "../../config/config.ts";
import { gitAuthEnv } from "./git-auth.ts";

const execFileAsync = promisify(execFile);

export class CloneTool {
  private readonly token: string;

  constructor(config: GithubConfig) {
    this.token = config.token;
  }

  async clone(url: string, destDir: string): Promise<void> {
    await execFileAsync("git", ["clone", url, destDir], { env: gitAuthEnv(this.token) });
  }

  async pull(repoPath: string): Promise<void> {
    await execFileAsync("git", ["pull"], { cwd: repoPath, env: gitAuthEnv(this.token) });
  }
}
