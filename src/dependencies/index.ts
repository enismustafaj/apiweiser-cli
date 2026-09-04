import type { LlmConfig } from "../config/config.ts";
import { DataSourcesModule } from "../data-sources/index.ts";
import { db } from "../db/singleton.ts";
import { CallSitesRepository } from "./db/call-sites-repository.ts";
import { PackagesRepository } from "./db/packages-repository.ts";
import { Scanner } from "./scanner/scanner.ts";
import { SbomTool } from "./tool/sbom-tool.ts";
import type { CallSite } from "./types.ts";

export class DependenciesModule {
  private readonly sbomTool = new SbomTool();
  private readonly scanner = new Scanner();
  private readonly packagesRepository = new PackagesRepository(db);
  private readonly callSitesRepository = new CallSitesRepository(db);
  private readonly dataSourcesModule: DataSourcesModule;

  constructor(llmConfig: LlmConfig) {
    this.dataSourcesModule = new DataSourcesModule(llmConfig);
  }

  async scan(repoPath: string): Promise<CallSite[]> {
    const dependencies = await this.sbomTool.generate(repoPath);
    const changedOrNew = this.packagesRepository.findChangedOrNew(dependencies);
    if (changedOrNew.length === 0) return [];

    // Must run before upsert() - once upserted, every dependency has a row.
    const newDependencies = this.packagesRepository.findNew(changedOrNew);

    this.packagesRepository.upsert(changedOrNew);

    const names = changedOrNew.map((dependency) => dependency.name);
    this.callSitesRepository.deleteForDependencies(names);

    const callSites = await this.scanner.findCallSites(repoPath, changedOrNew);
    this.callSitesRepository.insert(callSites);

    await this.dataSourcesModule.recordChangelogSources(newDependencies);

    return callSites;
  }
}
