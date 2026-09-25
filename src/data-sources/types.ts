export interface PendingLookup {
  pendingId: number;
  packageId: number;
  packageName: string;
}

export interface NpmPackageManifest {
  repository?: { url?: string } | string;
}

export interface DataSourceEntry {
  packageId: number;
  url: string;
}

export interface LatestRelease {
  tagName: string;
  body: string;
}
