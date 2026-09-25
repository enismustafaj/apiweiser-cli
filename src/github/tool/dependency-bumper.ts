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
    await this.bumpAll(repoPath, [{ name: packageName, newVersion }]);
  }

  // One install call per section (dependencies/devDependencies), not one
  // call per package - found the hard way on a real repo: bumping a single
  // scope-sibling alone (e.g. `npm install @angular/common@20.0.0`) fails
  // with a peer-dependency ERESOLVE, since Angular's own packages peer-
  // depend on their siblings at the exact same version. Giving the package
  // manager every sibling in one call lets it resolve the whole family's
  // peer graph together instead of one broken step at a time.
  async bumpAll(repoPath: string, packages: { name: string; newVersion: string }[]): Promise<void> {
    const specsBySection = new Map<DependencySection, string[]>();
    for (const pkg of packages) {
      const section = this.declaredIn(repoPath, pkg.name);
      if (!section) continue;
      const specs = specsBySection.get(section) ?? [];
      specs.push(`${pkg.name}@${pkg.newVersion}`);
      specsBySection.set(section, specs);
    }

    for (const [section, specs] of specsBySection) {
      await this.install(repoPath, specs, section === "devDependencies");
    }
  }

  private async install(repoPath: string, specs: string[], devFlag: boolean): Promise<void> {
    const manager = detectPackageManager(repoPath);

    if (manager === "yarn") {
      await execFileAsync(
        "npx",
        ["--yes", "yarn", "add", ...specs, ...(devFlag ? ["--dev"] : [])],
        {
          cwd: repoPath,
          maxBuffer: 1024 * 1024 * 20,
        },
      );
    } else if (manager === "pnpm") {
      await execFileAsync(
        "npx",
        ["--yes", "pnpm", "add", ...specs, ...(devFlag ? ["--save-dev"] : [])],
        { cwd: repoPath, maxBuffer: 1024 * 1024 * 20 },
      );
    } else {
      await execFileAsync("npm", ["install", ...specs, ...(devFlag ? ["--save-dev"] : [])], {
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
