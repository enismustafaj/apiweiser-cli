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

// Shared by pathFor (a directory, joined with "/") and remoteName (a flat
// registry package name, joined with "-") - both must agree on the same
// major-crossing-vs-exact-version rule, see docs/change-requests.md.
function key(fromVersion: string, toVersion: string, separator: string): string {
  const fromMajor = majorVersion(fromVersion);
  const toMajor = majorVersion(toVersion);
  return fromMajor === toMajor
    ? `${sanitize(fromVersion)}${separator}to${separator}${sanitize(toVersion)}`
    : `${fromMajor}${separator}to${separator}${toMajor}`;
}

export class CodemodRegistry {
  private readonly baseDir: string;

  constructor(baseDir: string = REGISTRY_DIR) {
    this.baseDir = baseDir;
  }

  pathFor(packageName: string, fromVersion: string, toVersion: string): string {
    const dir = this.dirFor(packageName, fromVersion, toVersion);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Same directory pathFor() would use/create, without the side effect -
  // for callers (e.g. the `publish` CLI command) that need to check
  // whether an entry already exists rather than always creating one.
  dirFor(packageName: string, fromVersion: string, toVersion: string): string {
    return join(this.baseDir, sanitize(packageName), key(fromVersion, toVersion, "_"));
  }

  // Registry package names are flat strings, not paths - same key rule as
  // pathFor, joined with "-" instead of directory separators. Used both to
  // search for an existing published match and as the name to publish
  // under, so a local entry and its remote counterpart always agree.
  // "@" is stripped too (not just "/") - a registry scope is its own
  // field, not part of the name string, so "@angular/core" shouldn't
  // become a name that still looks scoped.
  remoteName(packageName: string, fromVersion: string, toVersion: string): string {
    const name = sanitize(packageName).replace(/@/g, "");
    return `${name}-${key(fromVersion, toVersion, "-")}`;
  }
}
