import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "yarn" | "pnpm";

// Which lockfile is present decides the manager - running the wrong one
// (e.g. npm install on a yarn.lock repo) rewrites the other manager's
// lockfile into a shape its own parser then rejects.
export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}
