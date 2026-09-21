import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GithubConfig } from "../../config/config.ts";
import { CloneTool } from "./clone-tool.ts";

const CACHE_DIR = join(homedir(), ".apiweiser-cli", "repos");

export class RepoCloner {
  private readonly cloneTool: CloneTool;

  constructor(config: GithubConfig) {
    this.cloneTool = new CloneTool(config);
  }

  // Clones fresh the first time a URL is seen; pulls latest after that.
  async cloneOrPull(url: string): Promise<string> {
    const destDir = join(CACHE_DIR, this.dirNameFor(url));

    if (existsSync(join(destDir, ".git"))) {
      await this.cloneTool.pull(destDir);
    } else {
      await mkdir(CACHE_DIR, { recursive: true });
      await this.cloneTool.clone(url, destDir);
    }

    return destDir;
  }

  private dirNameFor(url: string): string {
    const match = url.replace(/\.git$/, "").match(/([^/:]+)\/([^/]+)$/);
    if (!match) throw new Error(`Not a recognizable git repo URL: ${url}`);
    return `${match[1]}-${match[2]}`;
  }
}
