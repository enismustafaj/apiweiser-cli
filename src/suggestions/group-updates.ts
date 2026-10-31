import semver from "semver";
import type { DependenciesRepository } from "../dependencies/db/dependencies-repository.ts";
import { InstalledDependencies } from "../dependencies/peer/installed-dependencies.ts";
import { PeerGrouper } from "../dependencies/peer/peer-grouper.ts";
import { RegistryPeers } from "../dependencies/peer/registry-peers.ts";
import type { PackageVersion } from "../dependencies/peer/types.ts";
import type { RenovateUpdate } from "./types.ts";

export interface UpgradePlan {
  groups: RenovateUpdate[][];
  skipped: { dependency: string; reason: string }[];
}

export class UpgradePlanner {
  private readonly grouper: PeerGrouper;

  constructor(grouper: PeerGrouper) {
    this.grouper = grouper;
  }

  static forRepo(repoPath: string, packages: DependenciesRepository): UpgradePlanner {
    const registry = new RegistryPeers();
    const installed = new InstalledDependencies(repoPath, packages, registry);
    return new UpgradePlanner(new PeerGrouper(registry, installed));
  }

  // One group per set of packages that must move together (see
  // PeerGrouper), built from each package's next leap. A package already in
  // an earlier group isn't raised again, so no package ends up in two
  // groups. When a new group reaches into earlier ones, they're rebuilt as
  // one - with the earlier groups' members kept at the versions they
  // already chose - or, if that conflicts, the earlier groups stay as they
  // were and the new package is skipped.
  async plan(updates: RenovateUpdate[]): Promise<UpgradePlan> {
    const candidates = new Map<string, string[]>();
    const rows = new Map<string, RenovateUpdate>();
    for (const update of updates) {
      candidates.set(update.dependency, [
        ...(candidates.get(update.dependency) ?? []),
        update.newVersion,
      ]);
      rows.set(`${update.dependency}@${update.newVersion}`, update);
    }

    let groups: PackageVersion[][] = [];
    const owner = new Map<string, PackageVersion[]>();
    const skipped: UpgradePlan["skipped"] = [];

    for (const next of this.pickNextLeap(updates)) {
      if (owner.has(next.dependency)) continue;
      const seed = { name: next.dependency, version: next.newVersion };

      // Rebuild until the group stops reaching into further earlier groups.
      const merged: PackageVersion[][] = [];
      let group;
      try {
        for (;;) {
          group = await this.grouper.build([...merged.flat(), seed], candidates);
          if (group.conflict) break;
          const reached = new Set(
            group.members.map((m) => owner.get(m.name)).filter((g) => g && !merged.includes(g)),
          );
          if (reached.size === 0) break;
          merged.push(...(reached as Set<PackageVersion[]>));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push({ dependency: seed.name, reason: `couldn't check peers: ${message}` });
        continue;
      }
      if (group.conflict) {
        skipped.push({ dependency: seed.name, reason: group.reason });
        continue;
      }

      const at =
        merged.length > 0 ? Math.min(...merged.map((g) => groups.indexOf(g))) : groups.length;
      groups = groups.filter((g) => !merged.includes(g));
      groups.splice(at, 0, group.members);
      for (const member of group.members) owner.set(member.name, group.members);
    }

    return {
      groups: groups.map((g) => g.map((m) => rows.get(`${m.name}@${m.version}`)!)),
      skipped,
    };
  }

  private pickNextLeap(updates: RenovateUpdate[]): RenovateUpdate[] {
    const byName = new Map<string, RenovateUpdate[]>();
    for (const update of updates) {
      const candidates = byName.get(update.dependency) ?? [];
      candidates.push(update);
      byName.set(update.dependency, candidates);
    }
    return [...byName.values()].map((candidates) => this.nextLeap(candidates));
  }

  private nextLeap(candidates: RenovateUpdate[]): RenovateUpdate {
    const current = semver.coerce(candidates[0]!.currentVersion);
    const sorted = candidates
      .map((update) => ({ update, version: semver.coerce(update.newVersion) }))
      .filter((c): c is { update: RenovateUpdate; version: semver.SemVer } => c.version !== null)
      .sort((a, b) => semver.compare(a.version, b.version));
    if (sorted.length === 0) return candidates[0]!;

    const crossing = current && sorted.find((c) => c.version.major > current.major);
    return (crossing || sorted[sorted.length - 1]!).update;
  }
}
