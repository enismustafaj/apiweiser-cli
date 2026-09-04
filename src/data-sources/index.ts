import type { LlmConfig } from "../config/config.ts";
import { ChangelogSourceAgent } from "../dependencies/agent/changelog-source-agent.ts";
import type { Dependency } from "../dependencies/types.ts";
import { db } from "../db/singleton.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";

export class DataSourcesModule {
  private readonly changelogSourceAgent: ChangelogSourceAgent;
  private readonly dataSourcesRepository = new DataSourcesRepository(db);

  constructor(llmConfig: LlmConfig) {
    this.changelogSourceAgent = new ChangelogSourceAgent(llmConfig);
  }

  async recordChangelogSources(dependencies: Dependency[]): Promise<void> {
    if (dependencies.length === 0) return;

    const sources = new Map<number, string>();
    for (const dependency of dependencies) {
      if (dependency.id === undefined) {
        console.error(`DataSourcesModule: skipping "${dependency.name}" - not upserted yet, no id`);
        continue;
      }
      try {
        const url = await this.changelogSourceAgent.findChangelogSource(dependency);
        sources.set(dependency.id, url);
      } catch (err) {
        console.error(
          `DataSourcesModule: failed to find changelog source for "${dependency.name}":`,
          err,
        );
      }
    }

    this.dataSourcesRepository.insert(sources);
  }
}
