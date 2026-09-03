import { db } from "../db/database.ts";
import type { CallSite } from "./types.ts";
import { CallSitesRepository } from "./db/call-sites-repository.ts";
import { PackagesRepository } from "./db/packages-repository.ts";
import { Scanner } from "./scanner/scanner.ts";
import { SbomTool } from "./tool/sbom-tool.ts";

export class DependenciesModule {
  private readonly sbomTool = new SbomTool();
  private readonly scanner = new Scanner();
  private readonly packagesRepository = new PackagesRepository(db);
  private readonly callSitesRepository = new CallSitesRepository(db);

  async scan(repoPath: string): Promise<CallSite[]> {
    const dependencies = await this.sbomTool.generate(repoPath);
    const changedOrNew = this.packagesRepository.findChangedOrNew(dependencies);
    if (changedOrNew.length === 0) return [];

    this.packagesRepository.upsert(changedOrNew);

    const names = changedOrNew.map((dependency) => dependency.name);
    this.callSitesRepository.deleteForDependencies(names);

    const callSites = await this.scanner.findCallSites(repoPath, changedOrNew);
    this.callSitesRepository.insert(callSites);
    return callSites;
  }
}
