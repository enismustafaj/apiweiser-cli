import semver from "semver";
import { fetchWithTimeout } from "../http.ts";
import type { LatestRelease } from "./types.ts";

interface GitHubRelease {
  tag_name: string;
  body: string | null;
}

const PER_PAGE = 100;
const MAX_PAGES = 20;

export class GitHubReleaseFetcher {
  private readonly token?: string;

  constructor(token?: string) {
    this.token = token;
  }

  async fetchRange(
    releasesUrl: string,
    fromVersion: string,
    toVersion: string,
  ): Promise<LatestRelease[]> {
    const from = semver.coerce(fromVersion);
    const to = semver.coerce(toVersion, { includePrerelease: true });
    if (!from || !to) return [];

    // Pre-releases are skipped (unless the target is one): coerce without
    // includePrerelease turns "5.0.0-alpha.1" into "5.0.0", so years-old
    // alphas used to land inside a 4.x -> 5.x range. Sorted by version, not
    // by GitHub's date order, since maintenance lines (4.x) keep releasing
    // after the next major's pre-releases.
    const includePrerelease = to.prerelease.length > 0;
    const releases = await this.fetchUntil(releasesUrl, from);
    return releases
      .map((release) => ({
        release,
        version: semver.coerce(release.tag_name, { includePrerelease: true }),
      }))
      .filter(
        (entry): entry is { release: GitHubRelease; version: semver.SemVer } =>
          entry.version !== null &&
          (includePrerelease || entry.version.prerelease.length === 0) &&
          semver.gt(entry.version, from) &&
          semver.lte(entry.version, to),
      )
      .sort((a, b) => semver.compare(a.version, b.version))
      .map(({ release }) => ({ tagName: release.tag_name, body: release.body ?? "" }));
  }

  private async fetchUntil(releasesUrl: string, from: semver.SemVer): Promise<GitHubRelease[]> {
    const all: GitHubRelease[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await this.fetchPage(releasesUrl, page);
      if (batch.length === 0) break;
      all.push(...batch);

      const oldest = semver.coerce(batch[batch.length - 1].tag_name);
      if (oldest && semver.lte(oldest, from)) break;
    }
    return all;
  }

  private async fetchPage(releasesUrl: string, page: number): Promise<GitHubRelease[]> {
    const headers: HeadersInit = { Accept: "application/vnd.github+json" };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const url = `${releasesUrl}?per_page=${PER_PAGE}&page=${page}`;
    const response = await fetchWithTimeout(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status} for ${url}`);
    }
    return (await response.json()) as GitHubRelease[];
  }
}
