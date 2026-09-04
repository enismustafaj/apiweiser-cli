// Once per run: walks every known data source, fetches its package's
// latest GitHub release, and classifies whether it's a breaking change.
// Registers the run (start/end/status) and each package's result.

import type { LlmConfig } from "../config/config.ts";
import { db } from "../db/singleton.ts";
import { BreakingChangeClassifierAgent } from "./agent/breaking-change-classifier.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { ReleaseAnalysisRepository } from "./db/release-analysis-repository.ts";
import { GitHubReleaseFetcher } from "./github-release-fetcher.ts";

// Paced delay before each classification call, so a run with many data
// sources doesn't blast the model's API and hit its rate limit. Also
// paces the GitHub API calls, though GitHub's own unauthenticated limit
// (60/hour) can still bottleneck a run with many packages - see
// docs/data-sources.md.
// ponytail: fixed constant until there's a reason to tune it.
const DELAY_BETWEEN_PACKAGES_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ReleaseAnalysisModule {
  private readonly classifier: BreakingChangeClassifierAgent;
  private readonly releaseFetcher = new GitHubReleaseFetcher();
  private readonly dataSourcesRepository = new DataSourcesRepository(db);
  private readonly releaseAnalysisRepository = new ReleaseAnalysisRepository(db);

  constructor(llmConfig: LlmConfig) {
    this.classifier = new BreakingChangeClassifierAgent(llmConfig);
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

  // One data source failing (no releases, GitHub rate limit, model
  // refusal, ...) doesn't abort the run - logged and skipped, same
  // resilience pattern as the rest of this module.
  private async analyzeOne(runId: number, packageId: number, url: string): Promise<void> {
    try {
      const release = await this.releaseFetcher.fetchLatest(url);
      if (!release) return; // no releases published for this package
      if (!release.body.trim()) return; // nothing to classify

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
