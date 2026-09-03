// Dependencies module: generates the dependency list via SbomTool, scans
// the repo for call sites of each dependency via Scanner, and persists them
// via CallSitesRepository.

import { db } from "../db/database.ts";
import type { CallSite } from "./types.ts";
import { CallSitesRepository } from "./db/call-sites-repository.ts";
import { Scanner } from "./scanner/scanner.ts";
import { SbomTool } from "./tool/sbom-tool.ts";

export class DependenciesModule {
  private readonly sbomTool = new SbomTool();
  private readonly scanner = new Scanner();
  private readonly callSitesRepository = new CallSitesRepository(db);

  async scan(repoPath: string): Promise<CallSite[]> {
    const dependencies = await this.sbomTool.generate(repoPath);
    const callSites = await this.scanner.findCallSites(repoPath, dependencies);
    this.callSitesRepository.insert(callSites);
    return callSites;
  }
}
