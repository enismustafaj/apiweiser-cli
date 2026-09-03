import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { RenovateUpdate } from "../types.ts";
import type { RenovateReport } from "./renovate-report.ts";

const execFileAsync = promisify(execFile);

const CACHE_DIR = join(homedir(), ".apiweiser-scanner", "renovate");

export class RenovateTool {
  async run(repoPath: string): Promise<RenovateUpdate[]> {
    const absoluteRepoPath = resolve(repoPath);
    await mkdir(CACHE_DIR, { recursive: true });
    const reportPath = join(CACHE_DIR, `${this.cacheKey(absoluteRepoPath)}.json`);

    await this.runRenovate(absoluteRepoPath, reportPath);

    const report: RenovateReport = JSON.parse(await readFile(reportPath, "utf8"));
    return this.toUpdates(report);
  }

  // Renovate exits non-zero for plenty of reasons unrelated to whether the
  // report itself was written (e.g. `platform=local` can't push branches,
  // which it still attempts during a dry run). So the exit code/error here
  // is ignored - if the report file is missing or malformed, reading it
  // right after will throw on its own.
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
      // see comment above - expected, not rethrown, but logged for
      // visibility in case it's actually something else going wrong.
      console.debug("renovate exited non-zero (ignored, trusting the report file):", err);
    }
  }

  private cacheKey(repoPath: string): string {
    // ponytail: hash the repo path instead of sanitizing it into a
    // filename, same trick as SbomTool.
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
