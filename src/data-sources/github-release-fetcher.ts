// Fetches the latest release from a package's GitHub releases API endpoint
// (the URL NpmRegistryLookup derived and DataSourcesRepository stored).

import type { LatestRelease } from "./types.ts";

interface GitHubRelease {
  tag_name: string;
  body: string | null;
}

export class GitHubReleaseFetcher {
  // `releasesUrl` is already the full API endpoint
  // (api.github.com/repos/<owner>/<repo>/releases) - GitHub returns newest
  // first, so the latest release is just the first element.
  async fetchLatest(releasesUrl: string): Promise<LatestRelease | null> {
    const response = await fetch(releasesUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} for ${releasesUrl}`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    const latest = releases[0];
    if (!latest) return null; // repo has no releases published

    return { tagName: latest.tag_name, body: latest.body ?? "" };
  }
}
