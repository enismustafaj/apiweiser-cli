export interface PullRequestPackage {
  name: string;
  version: string;
  newVersion: string;
}

export interface PullRequestRequest {
  repoPath: string;
  codemodPath: string;
  packages: PullRequestPackage[];
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
