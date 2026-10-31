export interface ChangelogOptions {
  path: string;
  group: string;
}

export interface PackageChangelog {
  name: string;
  from: string;
  to: string;
  source: string | null;
  releases: number;
  file: string | null;
  error?: string;
}

export interface ChangelogResult {
  repo: string;
  packages: PackageChangelog[];
}
