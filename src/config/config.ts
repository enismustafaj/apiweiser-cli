export interface LlmConfig {
  apiKey: string;
  url: string;
  model: string;
}

// `args` are flags that put the CLI into non-interactive/headless mode
// (Claude Code's `-p`, Codex's `exec`) - the prompt is appended after.
export interface CodingAgentConfig {
  command: string;
  args: string[];
}

// A PAT with repo/pull-request write access.
export interface GithubConfig {
  token: string;
}

// Optional - see docs/change-requests.md § Remote registry. Explicit, not
// inferred from which fields happen to be filled in: "local" means every
// codemod only ever lives in the local registry (today's behavior, and
// what omitting `codemodRegistry` entirely also means); "remote" means the
// coding agent also checks codemod.com's public registry before building,
// and a successful, PR-opened codemod gets published there too - which
// requires both `scope` and `apiKey` (see `ConfigLoader`, which validates
// that combination).
export type CodemodRegistryMode = "local" | "remote";

export interface CodemodRegistryConfig {
  mode: CodemodRegistryMode;
  scope?: string;
  apiKey?: string;
}

export interface AppConfig {
  llm: LlmConfig;
  codingAgent: CodingAgentConfig;
  github: GithubConfig;
  codemodRegistry?: CodemodRegistryConfig;
}
