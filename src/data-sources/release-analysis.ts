import type { GithubConfig, LlmConfig } from "../config/config.ts";
import { db } from "../db/singleton.ts";
import { BreakingChangeClassifierAgent } from "./agent/breaking-change-classifier.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { ReleaseAnalysisRepository } from "./db/release-analysis-repository.ts";
import { GitHubReleaseFetcher } from "./github-release-fetcher.ts";

// Paced so a run with many data sources doesn't hit the model's (or
// GitHub's unauthenticated, 60/hour) rate limit - see docs/data-sources.md.
// ponytail: fixed constant until there's a reason to tune it.
const DELAY_BETWEEN_PACKAGES_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReleaseAnalysisModule {
  private readonly classifier: BreakingChangeClassifierAgent;
  private readonly releaseFetcher: GitHubReleaseFetcher;
  private readonly dataSourcesRepository = new DataSourcesRepository(db);
  private readonly releaseAnalysisRepository = new ReleaseAnalysisRepository(db);

  // githubConfig is optional - falls back to unauthenticated (60/hour)
  // rather than requiring a token just to run this module in isolation.
  constructor(llmConfig: LlmConfig, githubConfig?: GithubConfig) {
    this.classifier = new BreakingChangeClassifierAgent(llmConfig);
    this.releaseFetcher = new GitHubReleaseFetcher(githubConfig?.token);
  }

  async run(): Promise<void> {
    const runId = this.releaseAnalysisRepository.startRun();

    try {
      const sources = this.dataSourcesRepository.listAll();
      for (const { packageId, url } of sources) {
        await this.analyzeOne(runId, packageId, url);
        await delay(DELAY_BETWEEN_PACKAGES_MS);
      }
      this.releaseAnalysisRepository.finishRun(runId, "completed");
    } catch (err) {
      this.releaseAnalysisRepository.finishRun(runId, "failed");
      throw err;
    }
  }

  // One data source failing doesn't abort the run - logged and skipped.
  private async analyzeOne(runId: number, packageId: number, url: string): Promise<void> {
    try {
      const release = await this.releaseFetcher.fetchLatest(url);
      if (!release) return;
      if (!release.body.trim()) return;

      const classification = await this.classifier.classify(release.body);
      this.releaseAnalysisRepository.insertResult(
        runId,
        packageId,
        release.tagName,
        classification,
      );
    } catch (err) {
      console.error(`ReleaseAnalysisModule: failed for package ${packageId} (${url}):`, err);
    }
  }
}
