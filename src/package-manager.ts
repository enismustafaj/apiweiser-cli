import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "yarn" | "pnpm";

export function detectPackageManager(repoPath: string): PackageManager {
  if (existsSync(join(repoPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  return "npm";
}
