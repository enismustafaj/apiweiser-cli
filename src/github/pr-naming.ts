import { sharedScope } from "../change-requests/registry-key.ts";
import type { PullRequestPackage } from "./types.ts";

// A group sharing one scope (e.g. every package under "@angular") is named
// after it; a peer-linked group across scopes (see docs/upgrade-grouping.md)
// names every package, since no single one stands for the rest.
function groupScope(packages: PullRequestPackage[]): string | null {
  return packages.length > 1 ? sharedScope(packages.map((p) => p.name)) : null;
}

// e.g. apiweiser-cli/base-ui/react-1.9.0+date-fns-4.4.0
export function branchName(packages: PullRequestPackage[]): string {
  const scope = groupScope(packages);
  const parts = scope
    ? [`${scope}-${packages[0]!.newVersion}`]
    : packages.map((p) => `${p.name}-${p.newVersion}`);
  const slug = parts.map((part) => part.replace(/^@/, "")).join("+");
  return `apiweiser-cli/${slug}`.replace(/[^\w.+/-]/g, "-");
}

export function commitMessage(packages: PullRequestPackage[]): string {
  const scope = groupScope(packages);
  if (scope) {
    const names = packages.map((p) => p.name).join(", ");
    return `Migrate ${scope} packages together (${names})`;
  }
  const steps = packages.map((p) => `${p.name} from ${p.version} to ${p.newVersion}`);
  return `Migrate ${steps.join(", ")}`;
}
