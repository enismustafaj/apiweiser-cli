export interface LlmConfig {
  apiKey: string;
  url: string;
  model: string;
}

export interface CodingAgentConfig {
  command: string;
  args: string[];
}

export interface GithubConfig {
  token: string;
}

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
