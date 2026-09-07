// Local registry of successfully-generated codemod packages, keyed by
// package name + version pair. A registry "entry" is just a directory - the
// codemod package CodingAgentService's agent scaffolds (via `codemod init`)
// lives directly at pathFor(...), no separate copy/import step.

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_DIR = join(homedir(), ".apiweiser-cli", "codemods");

// ponytail: strip path separators only - good enough for real npm package
// names/semver strings, which don't contain them anyway.
function sanitize(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

export class CodemodRegistry {
  private readonly baseDir: string;

  constructor(baseDir: string = REGISTRY_DIR) {
    this.baseDir = baseDir;
  }

  // Where CodingAgentService should scaffold/store the codemod package for
  // this exact upgrade. Created on demand - callers can rely on it existing
  // once this returns.
  pathFor(packageName: string, fromVersion: string, toVersion: string): string {
    const dir = join(
      this.baseDir,
      sanitize(packageName),
      `${sanitize(fromVersion)}_to_${sanitize(toVersion)}`,
    );
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Whether a codemod package was already generated (and presumably
  // succeeded) for this exact upgrade, so callers can skip re-running the
  // agent for something already solved.
  has(packageName: string, fromVersion: string, toVersion: string): boolean {
    const dir = join(
      this.baseDir,
      sanitize(packageName),
      `${sanitize(fromVersion)}_to_${sanitize(toVersion)}`,
    );
    return existsSync(join(dir, "codemod.yaml"));
  }
}
