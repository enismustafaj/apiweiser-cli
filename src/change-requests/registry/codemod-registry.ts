// See docs/change-requests.md for the keying scheme.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_DIR = join(homedir(), ".apiweiser-cli", "codemods");

// ponytail: strip path separators only - good enough for real npm package
// names, which don't contain them anyway.
function sanitize(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

function majorVersion(version: string): string {
  return version.match(/\d+/)?.[0] ?? sanitize(version);
}

export class CodemodRegistry {
  private readonly baseDir: string;

  constructor(baseDir: string = REGISTRY_DIR) {
    this.baseDir = baseDir;
  }

  pathFor(packageName: string, fromVersion: string, toVersion: string): string {
    const fromMajor = majorVersion(fromVersion);
    const toMajor = majorVersion(toVersion);
    const key =
      fromMajor === toMajor
        ? `${sanitize(fromVersion)}_to_${sanitize(toVersion)}`
        : `${fromMajor}_to_${toMajor}`;

    const dir = join(this.baseDir, sanitize(packageName), key);
    mkdirSync(dir, { recursive: true });
    return dir;
  }
}
