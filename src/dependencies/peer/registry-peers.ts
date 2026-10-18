import { fetchWithTimeout } from "../../http.ts";
import type { Packument, PeerRequirement } from "./types.ts";

export class RegistryPeers {
  private readonly packuments = new Map<string, Promise<Packument | null>>();

  async peersOf(name: string, version: string): Promise<PeerRequirement[] | null> {
    const manifest = (await this.packument(name))?.versions[version];
    if (!manifest) return null;

    const meta = manifest.peerDependenciesMeta ?? {};
    return Object.entries(manifest.peerDependencies ?? {}).map(([peer, range]) => ({
      name: peer,
      range,
      optional: meta[peer]?.optional === true,
    }));
  }

  private packument(name: string): Promise<Packument | null> {
    let cached = this.packuments.get(name);
    if (!cached) {
      cached = this.fetchPackument(name);
      cached.catch(() => this.packuments.delete(name));
      this.packuments.set(name, cached);
    }
    return cached;
  }

  private async fetchPackument(name: string): Promise<Packument | null> {
    const response = await fetchWithTimeout(
      `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
      { headers: { Accept: "application/vnd.npm.install-v1+json" } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status} for "${name}"`);
    }
    return (await response.json()) as Packument;
  }
}
