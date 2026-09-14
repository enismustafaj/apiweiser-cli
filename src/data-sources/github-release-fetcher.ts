import type { LatestRelease } from "./types.ts";

interface GitHubRelease {
  tag_name: string;
  body: string | null;
}

export class GitHubReleaseFetcher {
  // GitHub returns releases newest-first, so the latest is the first element.
  async fetchLatest(releasesUrl: string): Promise<LatestRelease | null> {
    const response = await fetch(releasesUrl, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} for ${releasesUrl}`);
    }

    const releases = (await response.json()) as GitHubRelease[];
    const latest = releases[0];
    if (!latest) return null;

    return { tagName: latest.tag_name, body: latest.body ?? "" };
  }
}
