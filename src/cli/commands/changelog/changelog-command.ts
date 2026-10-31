import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ChangelogSourcesRepository } from "../../../changelogs/db/changelog-sources-repository.ts";
import { GitHubReleaseFetcher } from "../../../changelogs/github-release-fetcher.ts";
import { NpmRegistryLookup } from "../../../changelogs/npm-registry-lookup.ts";
import type { LatestRelease } from "../../../changelogs/types.ts";
import type { Database } from "../../../db/database.ts";
import { DependenciesRepository } from "../../../dependencies/db/dependencies-repository.ts";
import { logger } from "../../../logger.ts";
import { parseGroupId } from "../../group-id.ts";
import type { Command } from "../../types.ts";
import type { ChangelogOptions, ChangelogResult, PackageChangelog } from "./types.ts";

const log = logger("changelog");

export class ChangelogCommand implements Command<ChangelogOptions, ChangelogResult> {
  private readonly npmRegistryLookup = new NpmRegistryLookup();
  private readonly releaseFetcher = new GitHubReleaseFetcher(process.env.GITHUB_TOKEN);
  private readonly dependenciesRepository: DependenciesRepository;
  private readonly changelogSourcesRepository: ChangelogSourcesRepository;

  constructor(db: Database) {
    this.dependenciesRepository = new DependenciesRepository(db);
    this.changelogSourcesRepository = new ChangelogSourcesRepository(db);
  }

  async run(options: ChangelogOptions): Promise<ChangelogResult> {
    const repo = resolve(options.path);
    const packages: PackageChangelog[] = [];
    for (const { name, to } of parseGroupId(options.group)) {
      packages.push(await this.changelogFor(repo, name, to));
    }
    return { repo, packages };
  }

  private async changelogFor(repo: string, name: string, to: string): Promise<PackageChangelog> {
    const found = this.dependenciesRepository.find(repo, name);
    if (!found)
      throw new Error(
        `"${name}" isn't a dependency of ${repo} - check the name, or run \`scan\` if it was just added`,
      );

    const changelog: PackageChangelog = {
      name,
      from: found.currentVersion,
      to,
      source: null,
      releases: 0,
      file: null,
    };
    try {
      const releasesUrl = await this.findSource(found.id, name);
      if (!releasesUrl) return changelog;

      changelog.source = this.toRepoUrl(releasesUrl);
      const releases = await this.releaseFetcher.fetchRange(releasesUrl, found.currentVersion, to);
      changelog.releases = releases.length;
      if (releases.length > 0) changelog.file = await this.writeNotes(changelog, releases);
    } catch (err) {
      changelog.error = err instanceof Error ? err.message : String(err);
      log.warn(`Changelog for "${name}" failed:`, changelog.error);
    }
    return changelog;
  }

  private async findSource(packageId: number, name: string): Promise<string | null> {
    const saved = this.changelogSourcesRepository.findUrl(name);
    if (saved) return saved;

    log.info(`Looking up the changelog source for "${name}" on npm`);
    const url = await this.npmRegistryLookup.findChangelogSource(name);
    if (url) this.changelogSourcesRepository.insert(new Map([[packageId, url]]));
    return url;
  }

  // Outside the repo, so the notes never show up in its git status. Named by
  // package and range, not repo - the same jump has the same notes anywhere.
  // ponytail: refetched and overwritten every run; reuse an existing file if
  // GitHub rate limits start to bite.
  private async writeNotes(
    changelog: PackageChangelog,
    releases: LatestRelease[],
  ): Promise<string> {
    const dir = join(homedir(), ".apiweiser-cli", "changelogs");
    await mkdir(dir, { recursive: true });
    const file = join(
      dir,
      `${changelog.name.replace("/", "__")}@${changelog.from}..${changelog.to}.md`,
    );
    await writeFile(file, this.toMarkdown(changelog, releases), "utf8");
    return file;
  }

  private toMarkdown(changelog: PackageChangelog, releases: LatestRelease[]): string {
    const sections = releases.map(
      (release) =>
        `## ${release.tagName}\n` +
        `${changelog.source}/releases/tag/${encodeURIComponent(release.tagName)}\n\n` +
        `${this.demoteHeadings(release.body.trim())}\n`,
    );
    return [
      `# ${changelog.name} ${changelog.from} → ${changelog.to}\n`,
      `Source: ${changelog.source}\n`,
      ...sections,
    ].join("\n");
  }

  // Two levels down, so a release's own "## What's Changed" sits under our
  // "## <tag>" instead of beside it. Fenced code is left alone - a "# ..."
  // line there is a shell comment, not a heading.
  private demoteHeadings(notes: string): string {
    let inFence = false;
    return notes
      .split("\n")
      .map((line) => {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        if (inFence) return line;
        return line.replace(/^(#{1,6})(?=\s)/, (hashes) =>
          "#".repeat(Math.min(hashes.length + 2, 6)),
        );
      })
      .join("\n");
  }

  // https://api.github.com/repos/<owner>/<repo>/releases -> https://github.com/<owner>/<repo>
  private toRepoUrl(releasesUrl: string): string {
    return releasesUrl
      .replace("https://api.github.com/repos/", "https://github.com/")
      .replace(/\/releases$/, "");
  }
}
