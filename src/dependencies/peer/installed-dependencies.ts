import type { PackagesRepository } from "../db/packages-repository.ts";
import type { RegistryPeers } from "./registry-peers.ts";
import type { InstalledDependent } from "./types.ts";

export class InstalledDependencies {
  private readonly repoPath: string;
  private readonly packages: PackagesRepository;
  private readonly registry: RegistryPeers;

  constructor(repoPath: string, packages: PackagesRepository, registry: RegistryPeers) {
    this.repoPath = repoPath;
    this.packages = packages;
    this.registry = registry;
  }

  version(name: string): string | null {
    return this.packages.findVersion(this.repoPath, name);
  }

  async dependentsOf(name: string): Promise<InstalledDependent[]> {
    const direct = this.packages.findDirect(this.repoPath);
    const peers = await Promise.all(
      direct.map((dep) => this.registry.peersOf(dep.name, dep.currentVersion)),
    );

    return direct.flatMap((dep, i) => {
      const peer = peers[i]?.find((p) => p.name === name);
      return peer ? [{ name: dep.name, version: dep.currentVersion, range: peer.range }] : [];
    });
  }
}
