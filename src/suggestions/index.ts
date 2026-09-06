// Suggestions module: runs Renovate via RenovateTool to get proposed
// version updates, and persists them via SuggestionsRepository.
//
// For each update, checks whether its new version was already classified
// by ReleaseAnalysisModule (see docs/data-sources.md) - if that release is
// breaking, raises a change request with the package's current call sites
// attached, so whoever handles it can see what actually needs updating.

import { ReleaseAnalysisRepository } from "../data-sources/db/release-analysis-repository.ts";
import { ChangeRequestsModule } from "../change-requests/index.ts";
import type { CodingAgentConfig, GithubConfig } from "../config/config.ts";
import { CallSitesRepository } from "../dependencies/db/call-sites-repository.ts";
import { db } from "../db/singleton.ts";
import { SuggestionsRepository } from "./db/suggestions-repository.ts";
import { RenovateTool } from "./tool/renovate-tool.ts";
import type { RenovateUpdate } from "./types.ts";

export class SuggestionsModule {
  private readonly renovateTool = new RenovateTool();
  private readonly suggestionsRepository = new SuggestionsRepository(db);
  private readonly releaseAnalysisRepository = new ReleaseAnalysisRepository(db);
  private readonly callSitesRepository = new CallSitesRepository(db);
  private readonly changeRequests: ChangeRequestsModule;

  constructor(codingAgentConfig: CodingAgentConfig, githubConfig: GithubConfig) {
    this.changeRequests = new ChangeRequestsModule(codingAgentConfig, githubConfig);
  }

  async generate(repoPath: string): Promise<RenovateUpdate[]> {
    const updates = await this.renovateTool.run(repoPath);
    this.suggestionsRepository.insert(updates);

    for (const update of updates) {
      await this.raiseChangeRequestIfBreaking(repoPath, update);
    }

    return updates;
  }

  private async raiseChangeRequestIfBreaking(
    repoPath: string,
    update: RenovateUpdate,
  ): Promise<void> {
    const result = this.releaseAnalysisRepository.findResult(update.dependency, update.newVersion);
    if (!result?.isBreaking) return;

    try {
      await this.changeRequests.create({
        repoPath,
        packageName: update.dependency,
        version: update.currentVersion,
        newVersion: update.newVersion,
        callSites: this.callSitesRepository.findForDependency(update.dependency),
        isBreaking: result.isBreaking,
        summary: result.summary,
      });
    } catch (err) {
      console.error(`SuggestionsModule: change request failed for "${update.dependency}":`, err);
    }
  }
}
