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

export interface AppConfig {
  llm: LlmConfig;
  codingAgent: CodingAgentConfig;
  github: GithubConfig;
}
