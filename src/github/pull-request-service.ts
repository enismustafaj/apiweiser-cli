import type { GithubConfig } from "../config/config.ts";

interface OpenPullRequestParams {
  title: string;
  head: string;
  base: string;
  body: string;
}

interface GitHubPullRequest {
  html_url: string;
}

export class PullRequestService {
  private readonly token: string;

  constructor(config: GithubConfig) {
    this.token = config.token;
  }

  async open(owner: string, repo: string, params: OpenPullRequestParams): Promise<string> {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API returned ${response.status} creating a PR for ${owner}/${repo}: ${await response.text()}`,
      );
    }

    const pr = (await response.json()) as GitHubPullRequest;
    return pr.html_url;
  }
}
