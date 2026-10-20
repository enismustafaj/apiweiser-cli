import type { DataSourcesModule } from "../data-sources/index.ts";
import type { Job } from "./scheduler.ts";

export class ChangelogLookupJob implements Job {
  readonly name = "Changelog lookup";
  private readonly dataSources: DataSourcesModule;

  constructor(dataSources: DataSourcesModule) {
    this.dataSources = dataSources;
  }

  run(): Promise<void> {
    return this.dataSources.processPendingLookups();
  }
}
