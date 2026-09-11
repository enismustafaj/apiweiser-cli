export interface Page<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
}

export interface PackageRow {
  repoPath: string;
  name: string;
  currentVersion: string;
  type: string;
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

export type Tab = "packages" | "suggestions" | "pull-requests";
