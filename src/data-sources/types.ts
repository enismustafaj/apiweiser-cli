// Shared types for the data-sources module.

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

export interface BreakingChangeClassification {
  isBreaking: boolean;
  summary: string;
}

export type ReleaseAnalysisRunStatus = "running" | "completed" | "failed";
