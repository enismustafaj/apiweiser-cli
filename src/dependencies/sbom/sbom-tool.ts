import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Dependency } from "../types.ts";
import type { InstalledPackage, PackageManifest } from "./types.ts";

// Reads what's installed straight from node_modules rather than `npm sbom`:
// npm validates the tree against its own rules first, so a tree installed
// by yarn (e.g. with `resolutions`) or pnpm fails as ESBOMPROBLEMS. Reading
// package.json files works whichever package manager did the install.
export class SbomTool {
  async generate(repoPath: string): Promise<Dependency[]> {
    const root = resolve(repoPath);
    const nodeModules = join(root, "node_modules");
    if (!existsSync(nodeModules)) {
      throw new Error(
        `${root} has no node_modules - install its dependencies first ` +
          "(Yarn Plug'n'Play installs aren't supported)",
      );
    }

    const manifest = await this.readManifest(root);
    const installed = await this.findInstalled(nodeModules);
    return this.toDependencies(manifest, installed);
  }

  // Every package under node_modules, top level first, then nested copies
  // (a/node_modules/b) and pnpm's store (node_modules/.pnpm/<id>/node_modules).
  // Symlinks (pnpm, workspaces) are followed once, by real path.
  private async findInstalled(nodeModules: string): Promise<InstalledPackage[]> {
    const installed: InstalledPackage[] = [];
    const seen = new Set<string>();
    const queue = [{ dir: nodeModules, topLevel: true }];

    for (let next = queue.shift(); next; next = queue.shift()) {
      for (const packageDir of await this.packageDirs(next.dir)) {
        const real = await realpath(packageDir).catch(() => null);
        if (!real || seen.has(real)) continue;
        seen.add(real);

        const manifest = await this.readManifest(real).catch(() => null);
        if (!manifest?.name || !manifest.version) continue;
        installed.push({ manifest, topLevel: next.topLevel });
        queue.push({ dir: join(real, "node_modules"), topLevel: false });
      }
      const store = join(next.dir, ".pnpm");
      if (next.topLevel && existsSync(store)) {
        for (const entry of await readdir(store)) {
          queue.push({ dir: join(store, entry, "node_modules"), topLevel: false });
        }
      }
    }
    return installed;
  }

  // node_modules/<name> and node_modules/@scope/<name>, skipping .bin,
  // .pnpm, .cache and the like.
  private async packageDirs(nodeModules: string): Promise<string[]> {
    const entries = await readdir(nodeModules).catch(() => []);
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      if (!entry.startsWith("@")) {
        dirs.push(join(nodeModules, entry));
        continue;
      }
      for (const scoped of await readdir(join(nodeModules, entry)).catch(() => [])) {
        dirs.push(join(nodeModules, entry, scoped));
      }
    }
    return dirs;
  }

  private async readManifest(dir: string): Promise<PackageManifest> {
    return JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as PackageManifest;
  }

  // One entry per name, the top-level copy (the one the repo itself gets -
  // findInstalled lists those first): the same package can be installed at
  // several versions (an older copy nested under another package), and
  // `packages` keeps one row per (repo, name) - otherwise whichever copy is
  // upserted last wins. A package is a dev dependency when no runtime
  // dependency reaches it, same as npm's own dev flag.
  private toDependencies(root: PackageManifest, installed: InstalledPackage[]): Dependency[] {
    const runtimeDirect = Object.keys({
      ...root.optionalDependencies,
      ...root.dependencies,
    });
    const direct = new Set([...runtimeDirect, ...Object.keys(root.devDependencies ?? {})]);

    const byName = new Map<string, InstalledPackage>();
    for (const pkg of installed) {
      if (!byName.has(pkg.manifest.name!)) byName.set(pkg.manifest.name!, pkg);
    }

    const runtime = this.reachable(runtimeDirect, byName);
    return [...byName.values()].map((pkg) => this.toDependency(pkg, direct, runtime));
  }

  // Names reachable from the root's runtime dependencies, walking each
  // package's own dependencies (peers included - they're installed for it).
  private reachable(from: string[], byName: Map<string, InstalledPackage>): Set<string> {
    const seen = new Set<string>();
    const queue = [...from];
    for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const manifest = byName.get(name)?.manifest;
      if (!manifest) continue;
      queue.push(
        ...Object.keys({
          ...manifest.dependencies,
          ...manifest.optionalDependencies,
          ...manifest.peerDependencies,
        }),
      );
    }
    return seen;
  }

  private toDependency(
    pkg: InstalledPackage,
    direct: Set<string>,
    runtime: Set<string>,
  ): Dependency {
    const name = pkg.manifest.name!;
    return {
      name,
      currentVersion: pkg.manifest.version!,
      type: pkg.topLevel && direct.has(name) ? "direct" : "transitive",
      isDevDependency: !runtime.has(name),
    };
  }
}
