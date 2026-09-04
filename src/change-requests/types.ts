import type { CallSite } from "../dependencies/types.ts";

export interface ChangeRequestInput {
  packageName: string;
  version: string;
  newVersion: string;
  callSites: CallSite[];
  isBreaking: boolean;
  summary: string;
}
