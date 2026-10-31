export type Harness = "claude" | "codex";

// The fields CodemodAi reads from `codemod ai list --format json`.
export interface CodemodSkillList {
  skills: { name: string; scope: string; path: string }[];
}
