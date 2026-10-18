import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectPackageManager } from "../../package-manager.ts";

const execFileAsync = promisify(execFile);

export class DependencyInstaller {
  // Using npm on a yarn/pnpm repo doesn't just fail - npm rewrites the
  // *other* manager's lockfile into a shape its own parser then rejects
  // (verified directly: npm install on a yarn.lock repo strips resolved
  // hashes and swaps registry.yarnpkg.com for registry.npmjs.org, breaking
  // yarn classic's parser on the very next `yarn add`). Matching whichever
  // manager the repo already committed a lockfile for avoids that.
  async install(repoPath: string): Promise<void> {
    if (!existsSync(join(repoPath, "package.json"))) return;

    const manager = detectPackageManager(repoPath);
    if (manager === "yarn") {
      await execFileAsync("npx", ["--yes", "yarn", "install"], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024 * 20,
      });
    } else if (manager === "pnpm") {
      await execFileAsync("npx", ["--yes", "pnpm", "install"], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024 * 20,
      });
    } else {
      await execFileAsync("npm", ["install", "--legacy-peer-deps"], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024 * 20,
      });
    }
  }
}
