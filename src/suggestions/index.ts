import { resolve } from "node:path";
import { ChangelogSummarizer } from "../data-sources/changelog-summarizer.ts";
import { ChangeRequestsModule } from "../change-requests/index.ts";
import type { CodingAgentConfig, GithubConfig, LlmConfig } from "../config/config.ts";
import { CallSitesRepository } from "../dependencies/db/call-sites-repository.ts";
import { db } from "../db/singleton.ts";
import { SuggestionsRepository } from "./db/suggestions-repository.ts";
import { dedupeByPackage, groupByScope } from "./group-updates.ts";
import { RenovateTool } from "./tool/renovate-tool.ts";
import type { RenovateUpdate } from "./types.ts";

export class SuggestionsModule {
  private readonly renovateTool = new RenovateTool();
  private readonly suggestionsRepository = new SuggestionsRepository(db);
  private readonly callSitesRepository = new CallSitesRepository(db);
  private readonly changelogSummarizer: ChangelogSummarizer;
  private readonly changeRequests: ChangeRequestsModule;

  constructor(
    llmConfig: LlmConfig,
    codingAgentConfig: CodingAgentConfig,
    githubConfig: GithubConfig,
  ) {
    this.changelogSummarizer = new ChangelogSummarizer(llmConfig, githubConfig);
    this.changeRequests = new ChangeRequestsModule(codingAgentConfig, githubConfig);
  }

  async generate(repoPath: string): Promise<RenovateUpdate[]> {
    const absoluteRepoPath = resolve(repoPath);

    const updates = await this.renovateTool.run(absoluteRepoPath);
    this.suggestionsRepository.insert(absoluteRepoPath, updates);

    for (const group of groupByScope(updates)) {
      await this.raiseChangeRequest(absoluteRepoPath, dedupeByPackage(group));
    }

    return updates;
  }

  private async raiseChangeRequest(repoPath: string, group: RenovateUpdate[]): Promise<void> {
    // devDependencies are never scanned for call sites (see
    // DependenciesModule.scan) - real API-surface migration doesn't apply
    // to dev tooling the same way, so the coding agent works from the
    // changelog summary alone instead of requiring call sites first.
    const isDevDependency = group.every((update) => update.depType === "devDependencies");
    const callSites = isDevDependency
      ? []
      : group.flatMap((update) =>
          this.callSitesRepository.findForDependency(repoPath, update.dependency),
        );
    if (!isDevDependency && callSites.length === 0) return;

    const summaries: string[] = [];
    for (const update of group) {
      try {
        const summary = await this.changelogSummarizer.summarize(
          update.dependency,
          update.currentVersion,
          update.newVersion,
        );
        if (summary)
          summaries.push(group.length === 1 ? summary : `## ${update.dependency}\n${summary}`);
      } catch (err) {
        console.error(
          `SuggestionsModule: changelog summarize failed for "${update.dependency}":`,
          err,
        );
      }
    }
    if (summaries.length === 0) return;

    const label = group.map((update) => update.dependency).join(", ");
    try {
      await this.changeRequests.create({
        repoPath,
        packages: group.map((update) => ({
          name: update.dependency,
          version: update.currentVersion,
          newVersion: update.newVersion,
        })),
        callSites,
        isDevDependency,
        summary: summaries.join("\n\n"),
      });
    } catch (err) {
      console.error(`SuggestionsModule: change request failed for "${label}":`, err);
    }
  }
}
