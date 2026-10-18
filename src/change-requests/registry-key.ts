import semver from "semver";
import type { ChangeRequestPackage } from "./types.ts";

export interface RegistryKey {
  label: string;
  fromVersion: string;
  toVersion: string;
}

export function registryKeyFor(packages: ChangeRequestPackage[]): RegistryKey {
  if (packages.length === 1) {
    const pkg = packages[0]!;
    return { label: pkg.name, fromVersion: pkg.version, toVersion: pkg.newVersion };
  }

  const scope = sharedScope(packages.map((p) => p.name));
  if (scope) {
    return {
      label: scope,
      fromVersion: extreme(
        packages.map((p) => p.version),
        "lt",
      ),
      toVersion: extreme(
        packages.map((p) => p.newVersion),
        "gt",
      ),
    };
  }

  // Peer-linked packages from different scopes (e.g. "@base-ui/react" +
  // "date-fns") share no version line - each keeps its own versions, in a
  // stable order, "+"-joined position by position (see CodemodRegistry).
  const sorted = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  return {
    label: sorted.map((p) => p.name).join("+"),
    fromVersion: sorted.map((p) => p.version).join("+"),
    toVersion: sorted.map((p) => p.newVersion).join("+"),
  };
}

// "@angular" when every package is under it, null otherwise (including
// any unscoped package).
export function sharedScope(names: string[]): string | null {
  const scopes = new Set(names.map((name) => (name.startsWith("@") ? name.split("/")[0]! : "")));
  const [scope] = scopes;
  return scopes.size === 1 && scope ? scope : null;
}

function extreme(versions: string[], keep: "lt" | "gt"): string {
  return versions.reduce((current, candidate) => {
    const a = semver.coerce(candidate);
    const b = semver.coerce(current);
    if (!a || !b) return current;
    return (keep === "lt" ? semver.lt(a, b) : semver.gt(a, b)) ? candidate : current;
  });
}
