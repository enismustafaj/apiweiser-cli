import { fetchWithTimeout } from "../http.ts";
import type { NpmPackageManifest } from "./types.ts";

export class NpmRegistryLookup {
  async findChangelogSource(packageName: string): Promise<string | null> {
    const response = await fetchWithTimeout(`https://registry.npmjs.org/${packageName}/latest`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status} for "${packageName}"`);
    }

    const manifest = (await response.json()) as NpmPackageManifest;
    const repositoryUrl =
      typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    if (!repositoryUrl) return null;

    const repo = this.extractGitHubRepo(repositoryUrl);
    // The GitHub API endpoint, not the HTML page - it's fetchable JSON.
    return repo ? `https://api.github.com/repos/${repo}/releases` : null;
  }

  // Normalizes the shapes npm's repository.url shows up in (git+https://,
  // git+ssh://git@, git@github.com:, "github:owner/repo", or a bare
  // "owner/repo") down to "owner/repo".
  private extractGitHubRepo(url: string): string | null {
    const cleaned = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^github:/, "")
      .replace(/#.*$/, "")
      .replace(/\.git$/, "");

    const hostMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);
    if (hostMatch) return `${hostMatch[1]}/${hostMatch[2]}`;

    const shorthandMatch = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
    return shorthandMatch ? `${shorthandMatch[1]}/${shorthandMatch[2]}` : null;
  }
}
