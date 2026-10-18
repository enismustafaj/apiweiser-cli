import type { CallSite } from "../dependencies/types.ts";

export interface ChangeRequestPackage {
  name: string;
  version: string;
  newVersion: string;
}

export interface ChangeRequestInput {
  repoPath: string;
  packages: ChangeRequestPackage[];
  callSites: CallSite[];
  summary: string;
}

// The agent's final-line report - see CodingAgentService.buildPrompt.
export interface CodemodResult {
  success: boolean;
  codemodPath: string;
  reason?: string;
}
