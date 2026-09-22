import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class DependencyInstaller {
  async install(repoPath: string): Promise<void> {
    if (!existsSync(join(repoPath, "package.json"))) return;
    await execFileAsync("npm", ["install"], { cwd: repoPath, maxBuffer: 1024 * 1024 * 20 });
  }
}
