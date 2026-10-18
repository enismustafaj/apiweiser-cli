// See docs/change-requests.md for the keying scheme.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REGISTRY_DIR = join(homedir(), ".apiweiser-cli", "codemods");

function sanitize(segment: string): string {
  return segment.replace(/[/\\]/g, "_");
}

function majorVersion(version: string): string {
  return version.match(/\d+/)?.[0] ?? sanitize(version);
}

// Shared by pathFor (a directory, joined with "/") and remoteName (a flat
// registry package name, joined with "-") - both must agree on the same
// major-crossing-vs-exact-version rule, see docs/change-requests.md.
// A mixed-scope group passes "+"-joined versions (see registryKeyFor) - the
// rule then applies per package, so "1.3.0+3.6.0" -> "1.9.0+4.4.0" keys as
// "1.3.0_to_1.9.0+3_to_4".
// ponytail: a single version with "+build" metadata gets split too - still a
// stable, unique key, just an odd-looking one; npm releases almost never
// carry build metadata.
function key(fromVersion: string, toVersion: string, separator: string): string {
  const toVersions = toVersion.split("+");
  return fromVersion
    .split("+")
    .map((from, i) => {
      const to = toVersions[i] ?? "";
      return majorVersion(from) === majorVersion(to)
        ? `${sanitize(from)}${separator}to${separator}${sanitize(to)}`
        : `${majorVersion(from)}${separator}to${separator}${majorVersion(to)}`;
    })
    .join("+");
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
    // "+" (a mixed-scope group, see registryKeyFor) isn't a safe name char.
    return `${name}-${key(fromVersion, toVersion, "-")}`.replace(/\+/g, "--");
  }
}
