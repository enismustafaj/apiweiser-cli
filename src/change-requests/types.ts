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

// The agent's final-line report - see CodingAgentService.buildPrompt.
export interface CodemodResult {
  success: boolean;
  codemodPath: string;
  reason?: string;
}
