import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { logger } from "../../logger.ts";
import type { RenovateUpdate } from "../types.ts";
import type { RenovateReport } from "./renovate-report.ts";

const execFileAsync = promisify(execFile);

const CACHE_DIR = join(homedir(), ".apiweiser-cli", "renovate");

const log = logger("renovate");

export class RenovateTool {
  async run(repoPath: string): Promise<RenovateUpdate[]> {
    const absoluteRepoPath = resolve(repoPath);
    await mkdir(CACHE_DIR, { recursive: true });
    const reportPath = join(CACHE_DIR, `${this.cacheKey(absoluteRepoPath)}.json`);

    await this.runRenovate(absoluteRepoPath, reportPath);

    const report: RenovateReport = JSON.parse(await readFile(reportPath, "utf8"));
    return this.toUpdates(report);
  }

  // Renovate exits non-zero for reasons unrelated to the report itself
  // (e.g. `platform=local` can't push branches) - ignored here; a missing
  // or malformed report throws on its own when read below.
  private async runRenovate(repoPath: string, reportPath: string): Promise<void> {
    try {
      await execFileAsync(
        "npx",
        [
          "--yes",
          "renovate",
          "--platform=local",
          "--dry-run=full",
          "--onboarding=false",
          "--require-config=optional",
          "--dependency-dashboard=false",
          // Restrict to the npm manager (package.json dependencies) -
          // without this, Renovate also proposes updates for things like
          // the Node.js runtime version itself (.nvmrc/engines.node,
          // datasource "node-version"), which isn't a real npm dependency
          // and has no depType at all in Renovate's own report.
          "--enabled-managers=npm",
          // One candidate per major (6.x, 7.x, ...) instead of only the
          // latest major, so pickNextLeap can choose the next one - see
          // docs/plan.md § Picking one update per package.
          "--separate-multiple-major=true",
          "--report-type=file",
          `--report-path=${reportPath}`,
        ],
        {
          cwd: repoPath,
          maxBuffer: 1024 * 1024 * 20,
          env: { ...process.env, LOG_LEVEL: "error" },
        },
      );
    } catch (err) {
      log.debug("Renovate exited non-zero (ignored, trusting the report file):", err);
    }
  }

  private cacheKey(repoPath: string): string {
    return createHash("sha1").update(repoPath).digest("hex").slice(0, 8);
  }

  private toUpdates(report: RenovateReport): RenovateUpdate[] {
    const repository = Object.values(report.repositories)[0];
    if (!repository) return [];

    const updates: RenovateUpdate[] = [];
    for (const packageFiles of Object.values(repository.packageFiles)) {
      for (const packageFile of packageFiles) {
        for (const dep of packageFile.deps) {
          for (const update of dep.updates) {
            updates.push({
              dependency: dep.depName,
              packageFile: packageFile.packageFile,
              depType: dep.depType,
              currentVersion: dep.currentVersion ?? dep.currentValue,
              newVersion: update.newVersion ?? update.newValue,
              updateType: update.updateType,
              datasource: dep.datasource,
              sourceUrl: dep.sourceUrl,
            });
          }
        }
      }
    }
    return updates;
  }
}
