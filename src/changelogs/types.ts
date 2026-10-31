export interface NpmPackageManifest {
  repository?: { url?: string } | string;
}

export interface LatestRelease {
  tagName: string;
  body: string;
}
