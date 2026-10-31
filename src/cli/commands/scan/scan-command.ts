import { resolve } from "node:path";
import type { Database } from "../../../db/database.ts";
import { DependenciesRepository } from "../../../dependencies/db/dependencies-repository.ts";
import { SbomTool } from "../../../dependencies/sbom/sbom-tool.ts";
import { Scanner } from "../../../dependencies/scanner/scanner.ts";
import type { CallSite, Dependency } from "../../../dependencies/types.ts";
import { logger } from "../../../logger.ts";
import type { Command } from "../../types.ts";
import type { ScannedCallSite, ScannedPackage, ScanOptions, ScanResult } from "./types.ts";

const log = logger("scan");

export class ScanCommand implements Command<ScanOptions, ScanResult> {
  private readonly sbomTool = new SbomTool();
  private readonly scanner = new Scanner();
  private readonly dependenciesRepository: DependenciesRepository;

  constructor(db: Database) {
    this.dependenciesRepository = new DependenciesRepository(db);
  }

  async run(options: ScanOptions): Promise<ScanResult> {
    const repo = resolve(options.path);

    log.info(`Generating SBOM for ${repo}`);
    const dependencies = await this.sbomTool.generate(repo);
    const changedOrNew = this.dependenciesRepository.findChangedOrNew(repo, dependencies);
    log.info(`${dependencies.length} dependencies, ${changedOrNew.length} changed or new`);

    if (changedOrNew.length > 0) {
      this.dependenciesRepository.upsert(repo, changedOrNew);
      this.dependenciesRepository.deleteCallSites(
        repo,
        changedOrNew.map((dependency) => dependency.name),
      );

      const runtime = changedOrNew.filter((dependency) => !dependency.isDevDependency);
      log.info(`Scanning call sites for ${runtime.length} runtime dependencies`);
      this.dependenciesRepository.insertCallSites(
        repo,
        await this.scanner.findCallSites(repo, runtime),
      );
    }

    const byName = Map.groupBy(
      this.dependenciesRepository.findCallSitesForRepo(repo),
      (site) => site.dependency,
    );

    const packages = dependencies
      .filter((dependency) => dependency.type === "direct")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((dependency) => this.toPackage(dependency, byName.get(dependency.name) ?? []));

    return { repo, packages };
  }

  private toPackage(dependency: Dependency, callSites: CallSite[]): ScannedPackage {
    return {
      name: dependency.name,
      version: dependency.currentVersion,
      dev: dependency.isDevDependency,
      callSites: callSites.map((site) => this.toCallSite(site)),
    };
  }

  private toCallSite(site: CallSite): ScannedCallSite {
    return { api: site.apiSurface, file: site.file, line: site.line };
  }
}
