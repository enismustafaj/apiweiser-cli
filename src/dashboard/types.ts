export interface Page<T> {
  rows: T[];
  page: number;
  totalPages: number;
  total: number;
}

export type Tab = "packages" | "pull-requests";

// Everything the page can be filtered by, straight off the query string.
// `repo` undefined means the repo list; set, it's that repo's view.
export interface DashboardState {
  tab: Tab;
  repo?: string;
  q?: string;
  page: number;
}

export interface RepoSummary {
  repoPath: string;
  dependencies: number;
  pullRequests: number;
}

export interface PackageRow {
  name: string;
  currentVersion: string;
}

export interface PullRequestPackage {
  name: string;
  version: string;
  newVersion: string;
}

// One opened PR. A group PR bumps several packages at once and is stored
// as one row per package, so they're gathered back up here.
export interface PullRequestRow {
  url: string;
  openedAt: string;
  packages: PullRequestPackage[];
}
