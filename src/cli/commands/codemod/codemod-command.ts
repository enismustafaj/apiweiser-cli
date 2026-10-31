import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { CodemodRegistry } from "../../../change-requests/registry/codemod-registry.ts";
import { CodemodSearch } from "../../../change-requests/registry/codemod-search.ts";
import type { Database } from "../../../db/database.ts";
import { DependenciesRepository } from "../../../dependencies/db/dependencies-repository.ts";
import { logger } from "../../../logger.ts";
import { parseGroupId } from "../../group-id.ts";
import type { Command } from "../../types.ts";
import type { CodemodCommandResult, CodemodOptions, PackageCodemod } from "./types.ts";

const SCOPE = "apiweiser";

const log = logger("codemod");

export class CodemodCommand implements Command<CodemodOptions, CodemodCommandResult> {
  private readonly registry = new CodemodRegistry();
  private readonly search = new CodemodSearch();
  private readonly dependenciesRepository: DependenciesRepository;

  constructor(db: Database) {
    this.dependenciesRepository = new DependenciesRepository(db);
  }

  async run(options: CodemodOptions): Promise<CodemodCommandResult> {
    const repo = resolve(options.path);
    const packages: PackageCodemod[] = [];
    for (const { name, to } of parseGroupId(options.group)) {
      packages.push(await this.codemodFor(repo, name, to));
    }
    return { repo, packages };
  }

  // No call sites, nothing to migrate - so no codemod dir, no search.
  private async codemodFor(repo: string, name: string, to: string): Promise<PackageCodemod> {
    const found = this.dependenciesRepository.find(repo, name);
    if (!found)
      throw new Error(
        `"${name}" isn't a dependency of ${repo} - check the name, or run \`scan\` if it was just added`,
      );

    const codemod: PackageCodemod = {
      name,
      from: found.currentVersion,
      to,
      callSites: this.dependenciesRepository.findCallSites(repo, name).length,
      remote: null,
      codemodDir: null,
      hasCodemod: false,
    };
    if (codemod.callSites === 0) return codemod;

    codemod.codemodDir = this.registry.dirFor(name, codemod.from, to);
    codemod.hasCodemod = existsSync(join(codemod.codemodDir, "codemod.yaml"));
    try {
      const remoteName = this.registry.remoteName(name, codemod.from, to);
      codemod.remote = await this.search.findExact(remoteName, SCOPE);
    } catch (err) {
      codemod.error = err instanceof Error ? err.message : String(err);
      log.warn(`Registry search for "${name}" failed:`, codemod.error);
    }
    return codemod;
  }
}
