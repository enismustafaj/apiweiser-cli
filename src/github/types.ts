export interface PullRequestRequest {
  repoPath: string;
  codemodPath: string;
  packageName: string;
  version: string;
  newVersion: string;
  summary: string;
}

export interface PullRequestResult {
  created: boolean;
  url?: string;
  reason?: string;
}

export interface GitHubRemote {
  owner: string;
  repo: string;
}
