// CodemodApplier's transform only migrates call-site syntax - bumping the
// dependency itself is a separate step, via whichever package manager the
// target repo actually uses.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectPackageManager } from "../../package-manager.ts";

const execFileAsync = promisify(execFile);

type DependencySection = "dependencies" | "devDependencies";

export class DependencyBumper {
  async bump(repoPath: string, packageName: string, newVersion: string): Promise<void> {
    const section = this.declaredIn(repoPath, packageName);
    if (!section) return;

    const manager = detectPackageManager(repoPath);
    const spec = `${packageName}@${newVersion}`;
    const devFlag = section === "devDependencies";

    if (manager === "yarn") {
      await execFileAsync("npx", ["--yes", "yarn", "add", spec, ...(devFlag ? ["--dev"] : [])], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024 * 20,
      });
    } else if (manager === "pnpm") {
      await execFileAsync(
        "npx",
        ["--yes", "pnpm", "add", spec, ...(devFlag ? ["--save-dev"] : [])],
        { cwd: repoPath, maxBuffer: 1024 * 1024 * 20 },
      );
    } else {
      await execFileAsync("npm", ["install", spec, ...(devFlag ? ["--save-dev"] : [])], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024 * 20,
      });
    }
  }

  // Deliberately excludes peerDependencies - bumping one without the
  // consuming project's own say-so is a bigger call than this should make.
  private declaredIn(repoPath: string, packageName: string): DependencySection | null {
    const pkg = JSON.parse(readFileSync(join(repoPath, "package.json"), "utf8"));
    if (pkg.dependencies?.[packageName]) return "dependencies";
    if (pkg.devDependencies?.[packageName]) return "devDependencies";
    return null;
  }
}
