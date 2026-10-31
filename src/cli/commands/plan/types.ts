import type { CallSite } from "../../../dependencies/types.ts";
import type { Vulnerability } from "../../../vulnerabilities/types.ts";

export interface PlanOptions {
  path: string;
  packages: string[];
}

export interface PlannedPackage {
  name: string;
  from: string;
  to: string;
  updateType: string;
  callSites: number;
  // Known advisories against the installed version - null when OSV couldn't
  // be reached, so "unknown" isn't mistaken for "none".
  vulnerabilities: Vulnerability[] | null;
}

export interface PlannedGroup {
  id: string;
  packages: PlannedPackage[];
}

export interface SkippedPackage {
  name: string;
  reason: string;
  vulnerabilities: Vulnerability[] | null;
}

export interface PlanResult {
  repo: string;
  groups: PlannedGroup[];
  skipped: SkippedPackage[];
}

// What PlanCommand looks up once per plan and every package reads from.
export interface PlanContext {
  callSites: Map<string, CallSite[]>;
  installed: Map<string, string>;
  vulnerabilities: Map<string, Vulnerability[]> | null;
}
