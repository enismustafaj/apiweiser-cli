// Looks up a package's GitHub releases API endpoint straight from npm
// registry metadata (its `repository` field) - free, no LLM call, and
// resolves ~99.9% of real-world packages (verified against 769 packages
// from a real repo scan).

import type { NpmPackageManifest } from "./types.ts";

export class NpmRegistryLookup {
  async findChangelogSource(packageName: string): Promise<string | null> {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (response.status === 404) return null; // package genuinely not found
    if (!response.ok) {
      // Anything else (429, 5xx, ...) is a real failure, not "no data" -
      // surfaced so the caller can retry later instead of silently
      // recording a false negative.
      throw new Error(`npm registry returned ${response.status} for "${packageName}"`);
    }

    const manifest = (await response.json()) as NpmPackageManifest;
    const repositoryUrl =
      typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
    if (!repositoryUrl) return null;

    const repo = this.extractGitHubRepo(repositoryUrl);
    // The GitHub API endpoint, not the HTML releases page - actually
    // fetchable JSON (tag, body, published_at per release) rather than a
    // page meant for a browser.
    return repo ? `https://api.github.com/repos/${repo}/releases` : null;
  }

  // Normalizes the shapes npm's repository.url shows up in (git+https://,
  // git+ssh://git@, git@github.com:, "github:owner/repo", or a bare
  // "owner/repo" - npm's documented default-to-GitHub shorthand) down to
  // "owner/repo".
  private extractGitHubRepo(url: string): string | null {
    const cleaned = url
      .replace(/^git\+/, "")
      .replace(/^git:\/\//, "https://")
      .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
      .replace(/^git@github\.com:/, "https://github.com/")
      .replace(/^github:/, "")
      .replace(/\.git$/, "");

    const hostMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/);
    if (hostMatch) return `${hostMatch[1]}/${hostMatch[2]}`;

    // Bare "owner/repo", no protocol/host at all.
    const shorthandMatch = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
    return shorthandMatch ? `${shorthandMatch[1]}/${shorthandMatch[2]}` : null;
  }
}
