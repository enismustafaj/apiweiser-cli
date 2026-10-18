import type { GithubConfig, LlmConfig } from "../config/config.ts";
import { db } from "../db/singleton.ts";
import { ChangelogSummarizerAgent } from "./agent/changelog-summarizer-agent.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { GitHubReleaseFetcher } from "./github-release-fetcher.ts";

const MAX_COMBINED_LENGTH = 60_000;

export class ChangelogSummarizer {
  private readonly releaseFetcher: GitHubReleaseFetcher;
  private readonly summarizerAgent: ChangelogSummarizerAgent;
  private readonly dataSourcesRepository = new DataSourcesRepository(db);

  constructor(llmConfig: LlmConfig, githubConfig?: GithubConfig) {
    this.releaseFetcher = new GitHubReleaseFetcher(githubConfig?.token);
    this.summarizerAgent = new ChangelogSummarizerAgent(llmConfig);
  }

  async summarize(
    packageName: string,
    fromVersion: string,
    toVersion: string,
  ): Promise<string | null> {
    const url = this.dataSourcesRepository.findUrl(packageName);
    if (!url) return null;

    const releases = await this.releaseFetcher.fetchRange(url, fromVersion, toVersion);
    const combined = releases
      .map((release) => `## ${release.tagName}\n${release.body}`)
      .join("\n\n")
      .trim();
    if (!combined) return null;

    return this.summarizerAgent.summarize(combined.slice(0, MAX_COMBINED_LENGTH));
  }
}
