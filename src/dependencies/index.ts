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
    // Canonicalized once, here, so the same repo scanned via a relative
    // path one run and an absolute path the next (or from a different cwd)
    // is still recognized as the same repo in `packages`/`call_sites`, not
    // as a second, separate one.
    const absoluteRepoPath = resolve(repoPath);

    const dependencies = await this.sbomTool.generate(absoluteRepoPath);
    const changedOrNew = this.packagesRepository.findChangedOrNew(absoluteRepoPath, dependencies);
    if (changedOrNew.length === 0) return [];

    // Must run before upsert() - once upserted, every dependency has a row.
    const newDependencies = this.packagesRepository.findNew(changedOrNew);

    this.packagesRepository.upsert(absoluteRepoPath, changedOrNew);

    const names = changedOrNew.map((dependency) => dependency.name);
    this.callSitesRepository.deleteForDependencies(absoluteRepoPath, names);

    const callSites = await this.scanner.findCallSites(absoluteRepoPath, changedOrNew);
    this.callSitesRepository.insert(absoluteRepoPath, callSites);

    // Just queues new packages for lookup - no network call, no blocking on
    // (or flooding) the npm registry. See DataSourcesModule/Scheduler.
    this.dataSourcesModule.enqueueForLookup(newDependencies);

    return callSites;
  }
}
