// Shared types for the data-sources module.

export interface PendingLookup {
  pendingId: number;
  packageId: number;
  packageName: string;
}

export interface NpmPackageManifest {
  repository?: { url?: string } | string;
}
