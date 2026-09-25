import semver from "semver";
import type { RenovateUpdate } from "./types.ts";

// Scope-siblings (e.g. @angular/core, @angular/router) are grouped into one
// change request, not raised independently - found the hard way on a real
// repo: bumping one alone fails with a peer-dependency ERESOLVE, since
// packages in the same scope commonly peer-depend on each other at the
// exact same version. `@types/*` is excluded on purpose - unlike a real
// scoped package family, `@types/react` and `@types/node` have nothing to
// do with each other's version numbers.
export function groupByScope(updates: RenovateUpdate[]): RenovateUpdate[][] {
  const byScope = new Map<string, RenovateUpdate[]>();
  const groups: RenovateUpdate[][] = [];

  for (const update of updates) {
    const scope = update.dependency.startsWith("@") ? update.dependency.split("/")[0]! : null;
    if (!scope || scope === "@types") {
      groups.push([update]);
      continue;
    }
    let group = byScope.get(scope);
    if (!group) {
      group = [];
      byScope.set(scope, group);
      groups.push(group);
    }
    group.push(update);
  }

  return groups;
}

// Renovate can propose more than one update for the *same* package (a
// minor path and a separate major path, when you're several majors
// behind) - each becomes its own row in `suggestions`, but they'd have no
// business both landing in the same group's `packages` list. Found the
// hard way running the full pipeline against a real repo: a group
// containing both "@angular/forms"@5.2.9->5.2.11 and @5.2.9->22.2.0
// produced `npm install @angular/forms@5.2.11 @angular/forms@22.2.0` in
// the same command, which npm can't resolve. Keeps whichever update
// reaches the highest version - the bigger jump is a superset of what the
// smaller one would have required.
export function dedupeByPackage(group: RenovateUpdate[]): RenovateUpdate[] {
  const byName = new Map<string, RenovateUpdate>();
  for (const update of group) {
    const existing = byName.get(update.dependency);
    const existingVersion = existing && semver.coerce(existing.newVersion);
    const candidateVersion = semver.coerce(update.newVersion);
    if (
      !existing ||
      (existingVersion && candidateVersion && semver.gt(candidateVersion, existingVersion))
    ) {
      byName.set(update.dependency, update);
    }
  }
  return [...byName.values()];
}
