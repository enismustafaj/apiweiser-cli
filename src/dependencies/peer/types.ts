export interface PeerRequirement {
  name: string;
  range: string;
  optional: boolean;
}

export interface InstalledDependent {
  name: string;
  version: string;
  range: string;
}

export interface PackageVersion {
  name: string;
  version: string;
}

export type PeerGroup =
  | { conflict: false; members: PackageVersion[] }
  | { conflict: true; members: PackageVersion[]; reason: string };

export interface Packument {
  versions: Record<
    string,
    {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    }
  >;
}

export class PeerConflict extends Error {}
