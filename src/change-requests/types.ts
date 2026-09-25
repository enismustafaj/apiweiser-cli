import type { CallSite } from "../dependencies/types.ts";

// Usually one package. More than one only when several scope-siblings
// (e.g. @angular/core, @angular/router) were grouped together by
// SuggestionsModule because they must be bumped in the same install call -
// see docs/suggestions.md § Grouping scoped packages.
export interface ChangeRequestPackage {
  name: string;
  version: string;
  newVersion: string;
}

export interface ChangeRequestInput {
  repoPath: string;
  packages: ChangeRequestPackage[];
  callSites: CallSite[];
  isDevDependency: boolean;
  summary: string;
}

// The agent's final-line report - see CodingAgentService.buildPrompt.
export interface CodemodResult {
  success: boolean;
  codemodPath: string;
  reason?: string;
}
