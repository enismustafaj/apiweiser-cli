import { resolve } from "node:path";
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
  private readonly dataSourcesModule = new DataSourcesModule();

  async scan(repoPath: string): Promise<CallSite[]> {
    // Canonicalized so the same repo is recognized as the same repo
    // regardless of relative/absolute path or cwd.
    const absoluteRepoPath = resolve(repoPath);

    const dependencies = await this.sbomTool.generate(absoluteRepoPath);
    const changedOrNew = this.packagesRepository.findChangedOrNew(absoluteRepoPath, dependencies);
    if (changedOrNew.length === 0) return [];

    // Must run before upsert() - upsert() gives every dependency a row.
    const newDependencies = this.packagesRepository.findNew(changedOrNew);

    this.packagesRepository.upsert(absoluteRepoPath, changedOrNew);

    const names = changedOrNew.map((dependency) => dependency.name);
    this.callSitesRepository.deleteForDependencies(absoluteRepoPath, names);

    const callSites = await this.scanner.findCallSites(absoluteRepoPath, changedOrNew);
    this.callSitesRepository.insert(absoluteRepoPath, callSites);

    this.dataSourcesModule.enqueueForLookup(newDependencies);

    return callSites;
  }
}
