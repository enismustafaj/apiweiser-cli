import type { CallSite } from "../dependencies/types.ts";

export interface ChangeRequestInput {
  repoPath: string;
  packageName: string;
  version: string;
  newVersion: string;
  callSites: CallSite[];
  isBreaking: boolean;
  summary: string;
}

// The agent's own final-line report - see CodingAgentService.buildPrompt,
// which requires it to print this as JSON so the result is parseable
// instead of scraped from prose.
export interface CodemodResult {
  success: boolean;
  codemodPath: string;
  reason?: string;
}

// `skipped` covers the cases GithubModule reports as created:false - a
// codemod that changed nothing, or a repo whose origin isn't GitHub -
// which are outcomes to explain later, not errors.
export type ChangeRequestStatus = "codemod_failed" | "skipped" | "pr_opened" | "pr_failed";

export interface ChangeRequestRecord {
  repoPath: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  summary: string;
  status: ChangeRequestStatus;
  detail?: string;
  codemodPath?: string;
  prUrl?: string;
  createdAt?: string;
}
