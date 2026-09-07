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
