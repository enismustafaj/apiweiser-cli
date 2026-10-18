import semver from "semver";
import type { InstalledDependencies } from "./installed-dependencies.ts";
import type { RegistryPeers } from "./registry-peers.ts";
import { PeerConflict, type PackageVersion, type PeerGroup } from "./types.ts";

// Builds the group of packages that must be bumped together with `seeds`,
// choosing versions only from Renovate's `candidates` (name -> versions).
// Seeds keep the versions they're given - several seeds let an existing
// group be extended without changing what it already chose.
// Keeps adding what the group forces in until nothing new is needed:
// forward - peers a member's new version needs that the installed version
// doesn't satisfy; reverse - installed packages whose peer range rejects a
// member's new version. Each is pulled in at its lowest fitting candidate.
// ponytail: greedy, no backtracking - an earlier "lowest fitting" choice is
// never revisited. Add backtracking if real conflicts show up that a higher
// candidate would have avoided.
export class PeerGrouper {
  private readonly registry: RegistryPeers;
  private readonly installed: InstalledDependencies;

  constructor(registry: RegistryPeers, installed: InstalledDependencies) {
    this.registry = registry;
    this.installed = installed;
  }

  // The only place that changes the group: forward/reverse just report.
  async build(seeds: PackageVersion[], candidates: Map<string, string[]>): Promise<PeerGroup> {
    const group = new Map(seeds.map((seed) => [seed.name, seed.version]));
    const queue = [...seeds];
    const join = (added: PackageVersion[]) => {
      for (const pkg of added) {
        group.set(pkg.name, pkg.version);
        queue.push(pkg);
      }
    };

    try {
      while (queue.length > 0) {
        const member = queue.shift()!;
        join(await this.forward(member, group, candidates));
        join(await this.reverse(member, group, candidates));
      }
    } catch (err) {
      if (!(err instanceof PeerConflict)) throw err;
      return { conflict: true, members: members(group), reason: err.message };
    }
    return { conflict: false, members: members(group) };
  }

  // Peers `member`'s new version needs that the installed version doesn't
  // satisfy.
  private async forward(
    member: PackageVersion,
    group: ReadonlyMap<string, string>,
    candidates: Map<string, string[]>,
  ): Promise<PackageVersion[]> {
    const peers = await this.registry.peersOf(member.name, member.version);
    if (!peers) {
      throw new PeerConflict(`the npm registry doesn't list ${label(member)}`);
    }

    const add: PackageVersion[] = [];
    for (const peer of peers) {
      const grouped = group.get(peer.name);
      if (grouped) {
        if (satisfies(grouped, peer.range)) continue;
        throw new PeerConflict(
          `${label(member)} needs ${peer.name} ${peer.range}, but the group already has ${peer.name}@${grouped}`,
        );
      }

      // Not installed at all: npm 7+ and pnpm install missing peers
      // themselves, at a fitting version, so nothing can conflict.
      const installed = this.installed.version(peer.name);
      if (!installed || satisfies(installed, peer.range)) continue;

      const offered = sorted(candidates.get(peer.name));
      const pick = offered.find((candidate) => satisfies(candidate, peer.range));
      if (!pick) {
        throw new PeerConflict(
          `${label(member)} needs ${peer.name} ${peer.range}; installed is ${installed}, Renovate offers [${offered.join(", ")}]`,
        );
      }
      add.push({ name: peer.name, version: pick });
    }
    return add;
  }

  // Installed packages whose peer range rejects `member`'s new version.
  private async reverse(
    member: PackageVersion,
    group: ReadonlyMap<string, string>,
    candidates: Map<string, string[]>,
  ): Promise<PackageVersion[]> {
    const add: PackageVersion[] = [];
    for (const dependent of await this.installed.dependentsOf(member.name)) {
      if (satisfies(member.version, dependent.range)) continue;

      // Already moving: what matters is its new version's range, not the
      // installed one dependentsOf reported.
      const grouped = group.get(dependent.name);
      if (grouped) {
        if (await this.accepts({ name: dependent.name, version: grouped }, member)) continue;
        throw new PeerConflict(`${dependent.name}@${grouped} doesn't accept ${label(member)}`);
      }

      const offered = sorted(candidates.get(dependent.name));
      let pick: string | undefined;
      for (const candidate of offered) {
        if (await this.accepts({ name: dependent.name, version: candidate }, member)) {
          pick = candidate;
          break;
        }
      }
      if (!pick) {
        throw new PeerConflict(
          `${label(dependent)} accepts ${member.name} ${dependent.range}, not ${member.version}, and none of Renovate's ${dependent.name} versions [${offered.join(", ")}] do`,
        );
      }
      add.push({ name: dependent.name, version: pick });
    }
    return add;
  }

  // Does `dependent` accept `peer`? Also true when `dependent` no longer
  // lists it as a peer at all.
  private async accepts(dependent: PackageVersion, peer: PackageVersion): Promise<boolean> {
    const peers = await this.registry.peersOf(dependent.name, dependent.version);
    if (!peers) return false;
    const range = peers.find((p) => p.name === peer.name)?.range;
    return !range || satisfies(peer.version, range);
  }
}

function label(pkg: PackageVersion): string {
  return `${pkg.name}@${pkg.version}`;
}

function satisfies(version: string, range: string): boolean {
  return semver.satisfies(version, range);
}

function sorted(versions: string[] | undefined): string[] {
  return (versions ?? []).filter((v) => semver.valid(v)).sort(semver.compare);
}

function members(group: Map<string, string>): PackageVersion[] {
  return [...group].map(([name, version]) => ({ name, version }));
}
