import semver from "semver";
import { fetchWithTimeout } from "../http.ts";
import type { LatestRelease } from "./types.ts";

interface GitHubRelease {
  tag_name: string;
  body: string | null;
}

const PER_PAGE = 100;
// ponytail: a hard ceiling, not full pagination to the repo's very first
// release - found the hard way on a real repo (next.js) that tags several
// canary releases a day, so its *first page* of the (undocumented) default
// 30-per-page can be a solid wall of `-canary.N` tags newer than any real
// target range, making every lookup silently come back empty. 20 pages
// (2,000 releases) comfortably covers that case; upgrade to real pagination
// if a repo is ever found where even this isn't enough.
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
    const to = semver.coerce(toVersion);
    if (!from || !to) return [];

    const releases = await this.fetchUntil(releasesUrl, from);
    return releases
      .filter((release) => {
        const version = semver.coerce(release.tag_name);
        return version !== null && semver.gt(version, from) && semver.lte(version, to);
      })
      .reverse()
      .map((release) => ({ tagName: release.tag_name, body: release.body ?? "" }));
  }

  // Releases come back newest-first, so once a page's oldest entry has
  // already coerced to <= `from`, every earlier page is guaranteed to be
  // in range and every later page is guaranteed not to be - safe to stop.
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
