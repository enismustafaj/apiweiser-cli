import type { Harness } from "../../../skills/types.ts";

export interface SkillInstallOptions {
  harness?: Harness;
}

export interface SkillInstallResult {
  harness: Harness;
  skills: string[];
  // The harness's user-level instructions file the skill rule was added to
  instructions: string;
}
