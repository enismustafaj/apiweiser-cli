export interface BreakingChange {
  packageName: string;
  repoPath: string;
  releaseTag: string;
  summary: string;
  detectedAt: string;
}

export interface Suggestion {
  repoPath: string;
  dependency: string;
  packageFile: string;
  depType: string;
  currentVersion: string;
  newVersion: string;
  updateType: string;
  datasource: string;
  sourceUrl: string | null;
  scannedAt: string;
}

export interface TrackedDependency {
  repoPath: string;
  name: string;
  currentVersion: string;
  type: string;
  callSiteCount: number;
}

export interface CallSiteRow {
  repoPath: string;
  dependency: string;
  file: string;
  line: number;
  snippet: string;
  apiSurface: string;
}

export interface Overview {
  repos: string[];
  dependencies: number;
  callSites: number;
  suggestions: number;
  breakingReleases: number;
  changeRequestsByStatus: Record<string, number>;
  lastReleaseAnalysis: { startedAt: string; endedAt: string | null; status: string } | null;
}
