import { resolve } from "node:path";
import { ChangelogSummarizer } from "../data-sources/changelog-summarizer.ts";
import { ChangeRequestsModule } from "../change-requests/index.ts";
import type { AppConfig } from "../config/config.ts";
import { CallSitesRepository } from "../dependencies/db/call-sites-repository.ts";
import { PackagesRepository } from "../dependencies/db/packages-repository.ts";
import { db } from "../db/singleton.ts";
import { logger } from "../logger.ts";
import { SuggestionsRepository } from "./db/suggestions-repository.ts";
import { UpgradePlanner } from "./group-updates.ts";
import { RenovateTool } from "./tool/renovate-tool.ts";
import type { RenovateUpdate } from "./types.ts";

const log = logger("suggestions");

export class SuggestionsModule {
  private readonly renovateTool = new RenovateTool();
  private readonly suggestionsRepository = new SuggestionsRepository(db);
  private readonly callSitesRepository = new CallSitesRepository(db);
  private readonly packagesRepository = new PackagesRepository(db);
  private readonly changelogSummarizer: ChangelogSummarizer;
  private readonly changeRequests: ChangeRequestsModule;

  constructor(config: AppConfig) {
    this.changelogSummarizer = new ChangelogSummarizer(config.llm, config.github);
    this.changeRequests = new ChangeRequestsModule(
      config.codingAgent,
      config.github,
      config.codemodRegistry,
    );
  }

  async generate(repoPath: string): Promise<RenovateUpdate[]> {
    const absoluteRepoPath = resolve(repoPath);

    log.info(`Running Renovate on ${absoluteRepoPath}`);
    const updates = await this.renovateTool.run(absoluteRepoPath);
    log.info(`Renovate found ${updates.length} updates`);
    this.suggestionsRepository.insert(absoluteRepoPath, updates);

    const plan = await UpgradePlanner.forRepo(absoluteRepoPath, this.packagesRepository).plan(
      updates,
    );

    for (const { dependency, reason } of plan.skipped) {
      log.info(`Skipping "${dependency}": ${reason}`);
    }
    log.info(`Planned ${plan.groups.length} upgrade groups`);

    for (const [i, group] of plan.groups.entries()) {
      log.info(`Group ${i + 1}/${plan.groups.length}: ${describe(group)}`);
      await this.raiseChangeRequest(absoluteRepoPath, group);
    }

    return updates;
  }

  private async raiseChangeRequest(repoPath: string, group: RenovateUpdate[]): Promise<void> {
    const callSites = group.flatMap((update) =>
      this.callSitesRepository.findForDependency(repoPath, update.dependency),
    );
    if (callSites.length === 0) {
      log.info("No call sites - skipping");
      return;
    }

    log.info(`Summarizing changelogs (${callSites.length} call sites)`);
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
        log.error(`Changelog summarize failed for "${update.dependency}":`, err);
      }
    }
    if (summaries.length === 0) {
      log.info("No changelog summary available - skipping");
      return;
    }

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
        summary: summaries.join("\n\n"),
      });
    } catch (err) {
      log.error(`Change request failed for "${label}":`, err);
    }
  }
}

function describe(group: RenovateUpdate[]): string {
  return group
    .map((update) => `${update.dependency} ${update.currentVersion} -> ${update.newVersion}`)
    .join(", ");
}
