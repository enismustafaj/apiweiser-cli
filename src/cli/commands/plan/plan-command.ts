import { resolve } from "node:path";
import type { Database } from "../../../db/database.ts";
import { DependenciesRepository } from "../../../dependencies/db/dependencies-repository.ts";
import { logger } from "../../../logger.ts";
import { UpgradePlanner } from "../../../suggestions/group-updates.ts";
import { RenovateTool } from "../../../suggestions/tool/renovate-tool.ts";
import type { RenovateUpdate } from "../../../suggestions/types.ts";
import { OsvClient } from "../../../vulnerabilities/osv-client.ts";
import type { Vulnerability } from "../../../vulnerabilities/types.ts";
import type { Command } from "../../types.ts";
import type {
  PlanContext,
  PlannedGroup,
  PlannedPackage,
  PlanOptions,
  PlanResult,
  SkippedPackage,
} from "./types.ts";

const log = logger("plan");

export class PlanCommand implements Command<PlanOptions, PlanResult> {
  private readonly renovateTool = new RenovateTool();
  private readonly osvClient = new OsvClient();
  private readonly dependenciesRepository: DependenciesRepository;

  constructor(db: Database) {
    this.dependenciesRepository = new DependenciesRepository(db);
  }

  async run(options: PlanOptions): Promise<PlanResult> {
    const repo = resolve(options.path);
    if (this.dependenciesRepository.findDirect(repo).length === 0) {
      throw new Error(`${repo} hasn't been scanned - run \`scan\` on it first`);
    }

    log.info(`Running Renovate on ${repo}`);
    const updates = await this.renovateTool.run(repo);
    log.info(`Renovate found ${updates.length} updates`);

    const plan = await UpgradePlanner.forRepo(repo, this.dependenciesRepository).plan(updates);

    const callSites = Map.groupBy(
      this.dependenciesRepository.findCallSitesForRepo(repo),
      (site) => site.dependency,
    );
    const wanted = (name: string) =>
      options.packages.length === 0 || options.packages.includes(name);
    const groups = plan.groups.filter((group) => group.some((update) => wanted(update.dependency)));
    const skipped = plan.skipped.filter((skip) => wanted(skip.dependency));
    const installed = this.findInstalled(repo, [
      ...groups.flat().map((update) => update.dependency),
      ...skipped.map((skip) => skip.dependency),
    ]);
    const vulnerabilities = await this.findVulnerabilities(installed);

    return {
      repo,
      groups: groups.map((group) => this.toGroup(group, { callSites, installed, vulnerabilities })),
      skipped: skipped.map((skip) => this.toSkipped(skip.dependency, skip.reason, vulnerabilities)),
    };
  }

  // The installed versions scan recorded - what `from` and the vulnerability
  // lookup use, so plan agrees with changelog and codemod. Renovate's own
  // currentVersion can be the range's newest match instead (vitesse's pinia:
  // 2.3.1 from the range, 2.0.11 installed), when it can't read the lockfile.
  private findInstalled(repo: string, names: string[]): Map<string, string> {
    const installed = new Map<string, string>();
    for (const name of new Set(names)) {
      const found = this.dependenciesRepository.find(repo, name);
      if (found) installed.set(name, found.currentVersion);
    }
    return installed;
  }

  // A failed lookup doesn't fail the plan - every package's vulnerabilities
  // is then null.
  private async findVulnerabilities(
    installed: Map<string, string>,
  ): Promise<Map<string, Vulnerability[]> | null> {
    const packages = [...installed].map(([name, version]) => ({ name, version }));
    try {
      return await this.osvClient.findVulnerabilities(packages);
    } catch (err) {
      log.warn("Vulnerability lookup failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  private toGroup(group: RenovateUpdate[], context: PlanContext): PlannedGroup {
    const packages = group
      .map((update) => this.toPackage(update, context))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: packages.map((pkg) => `${pkg.name}@${pkg.to}`).join("+"),
      packages,
    };
  }

  private toPackage(
    update: RenovateUpdate,
    { callSites, installed, vulnerabilities }: PlanContext,
  ): PlannedPackage {
    return {
      name: update.dependency,
      from: installed.get(update.dependency) ?? update.currentVersion,
      to: update.newVersion,
      updateType: update.updateType,
      callSites: callSites.get(update.dependency)?.length ?? 0,
      vulnerabilities: vulnerabilities && (vulnerabilities.get(update.dependency) ?? []),
    };
  }

  private toSkipped(
    name: string,
    reason: string,
    vulnerabilities: Map<string, Vulnerability[]> | null,
  ): SkippedPackage {
    return { name, reason, vulnerabilities: vulnerabilities && (vulnerabilities.get(name) ?? []) };
  }
}
