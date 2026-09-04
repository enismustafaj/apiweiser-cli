import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Dependency } from "../types.ts";
import type { CycloneDxDocument } from "./cyclonedx.types.ts";

const execFileAsync = promisify(execFile);

const CACHE_DIR = join(homedir(), ".apiweiser-scanner", "sbom");

export class SbomTool {
  async generate(repoPath: string): Promise<Dependency[]> {
    const absoluteRepoPath = resolve(repoPath);

    const { stdout } = await execFileAsync("npm", ["sbom", "--sbom-format", "cyclonedx"], {
      cwd: absoluteRepoPath,
      maxBuffer: 1024 * 1024 * 20,
    });

    await this.writeToCache(absoluteRepoPath, stdout);

    const sbom: CycloneDxDocument = JSON.parse(stdout);
    return this.toDependencies(sbom);
  }

  private async writeToCache(repoPath: string, rawSbom: string): Promise<string> {
    await mkdir(CACHE_DIR, { recursive: true });
    // ponytail: hash the repo path instead of sanitizing it into a filename,
    // good enough to avoid collisions between repos without a path parser.
    const key = createHash("sha1").update(repoPath).digest("hex").slice(0, 8);
    const outputFile = join(CACHE_DIR, `${key}.json`);
    await writeFile(outputFile, rawSbom, "utf8");
    return outputFile;
  }

  private toDependencies(sbom: CycloneDxDocument): Dependency[] {
    const rootRef = sbom.metadata.component["bom-ref"];
    const rootDeps = sbom.dependencies.find((entry) => entry.ref === rootRef);
    const directRefs = new Set(rootDeps?.dependsOn ?? []);

    return sbom.components.map((component) => ({
      name: component.name,
      currentVersion: component.version,
      type: directRefs.has(component["bom-ref"]) ? "direct" : "transitive",
    }));
  }
}
