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

  const first = packages[0]!.name;
  const label = first.startsWith("@")
    ? first.split("/")[0]!
    : packages.map((p) => p.name).join("+");
  return {
    label,
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

function extreme(versions: string[], keep: "lt" | "gt"): string {
  return versions.reduce((current, candidate) => {
    const a = semver.coerce(candidate);
    const b = semver.coerce(current);
    if (!a || !b) return current;
    return (keep === "lt" ? semver.lt(a, b) : semver.gt(a, b)) ? candidate : current;
  });
}
