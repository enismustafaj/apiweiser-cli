export interface Page<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
}

export type Tab = "packages" | "call-sites" | "suggestions" | "pull-requests";

export type PackageType = "direct" | "transitive";

// Everything the page can be filtered by, straight off the query string.
// `repo` undefined means "every repo".
export interface DashboardState {
  tab: Tab;
  repo?: string;
  q?: string;
  type?: PackageType;
  package?: string;
  api?: string;
  page: number;
}

export interface Summary {
  direct: number;
  transitive: number;
  callSites: number;
  packagesWithCallSites: number;
  suggestions: number;
  pullRequests: number;
}

export interface PackageRow {
  repoPath: string;
  name: string;
  currentVersion: string;
  type: string;
  callSites: number;
}

export interface CallSiteUsageRow {
  repoPath: string;
  packageName: string;
  type: string;
  callSites: number;
  files: number;
  apiSurfaces: number;
}

export interface CallSiteRow {
  repoPath: string;
  packageName: string;
  file: string;
  line: number;
  snippet: string;
  apiSurface: string;
}

export interface ApiSurfaceCount {
  apiSurface: string;
  count: number;
}

export interface SuggestionRow {
  repoPath: string;
  dependency: string;
  currentVersion: string;
  newVersion: string;
  updateType: string;
  scannedAt: string;
}

export interface PullRequestRow {
  repoPath: string;
  packageName: string;
  version: string;
  newVersion: string;
  url: string;
  openedAt: string;
}
