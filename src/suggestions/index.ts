// Suggestions module: runs Renovate via RenovateTool to get proposed
// version updates, and persists them via SuggestionsRepository.
//
// For each update, checks whether its new version was already classified
// by ReleaseAnalysisModule (see docs/data-sources.md) - if that release is
// breaking, raises a change request with the package's current call sites
// attached, so whoever handles it can see what actually needs updating.

import { ChangeRequestsModule } from "../change-requests/index.ts";
import { ReleaseAnalysisRepository } from "../data-sources/db/release-analysis-repository.ts";
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
  private readonly changeRequests?: ChangeRequestsModule;

  // changeRequests is optional: raising change requests needs a configured
  // codemod agent (see ChangeRequestsModuleOptions.agent), so callers that
  // haven't set one up yet can still use plain suggestion scanning.
  constructor(changeRequests?: ChangeRequestsModule) {
    this.changeRequests = changeRequests;
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
    if (!this.changeRequests) return;

    const result = this.releaseAnalysisRepository.findResult(update.dependency, update.newVersion);
    if (!result?.isBreaking) return;

    try {
      await this.changeRequests.create({
        repoPath,
        datasource: update.datasource,
        packageName: update.dependency,
        fromVersion: update.currentVersion,
        toVersion: update.newVersion,
        packageFile: update.packageFile,
        changelog: result.summary,
        callSites: this.callSitesRepository.findForDependency(update.dependency),
      });
    } catch (err) {
      console.error(`SuggestionsModule: change request failed for "${update.dependency}":`, err);
    }
  }
}
