// See docs/codemods.md for the keying scheme.

import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_DIR = join(homedir(), ".apiweiser-cli", "codemods");

function sanitize(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

function majorVersion(version: string): string {
  return version.match(/\d+/)?.[0] ?? sanitize(version);
}

// Shared by dirFor (a directory, joined with "_") and remoteName (a flat
// registry package name, joined with "-") - both must agree on the same
// major-crossing-vs-exact-version rule, see docs/codemods.md.
function key(fromVersion: string, toVersion: string, separator: string): string {
  return majorVersion(fromVersion) === majorVersion(toVersion)
    ? `${sanitize(fromVersion)}${separator}to${separator}${sanitize(toVersion)}`
    : `${majorVersion(fromVersion)}${separator}to${separator}${majorVersion(toVersion)}`;
}

export class CodemodRegistry {
  private readonly baseDir: string;

  constructor(baseDir: string = REGISTRY_DIR) {
    this.baseDir = baseDir;
  }

  // Where this upgrade's codemod lives - not created here: the agent creates
  // it when it writes the codemod, `codemod` only checks for one.
  dirFor(packageName: string, fromVersion: string, toVersion: string): string {
    return join(this.baseDir, sanitize(packageName), key(fromVersion, toVersion, "_"));
  }

  // Registry package names are flat strings, not paths - same key rule as
  // dirFor, joined with "-" instead of directory separators. Used both to
  // search for an existing published match and as the name to publish
  // under, so a local entry and its remote counterpart always agree.
  // "@" is stripped too (not just "/") - a registry scope is its own
  // field, not part of the name string, so "@angular/core" shouldn't
  // become a name that still looks scoped.
  remoteName(packageName: string, fromVersion: string, toVersion: string): string {
    const name = sanitize(packageName).replace(/@/g, "");
    // "+" (build metadata, e.g. 1.0.0+abc) isn't a safe name char.
    return `${name}-${key(fromVersion, toVersion, "-")}`.replace(/\+/g, "--");
  }
}
