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

export interface RemoteCodemodRegistryConfig {
  mode: "remote";
  scope: string;
  apiKey: string;
}

// Checking `mode === "remote"` narrows to the variant that has scope and
// apiKey, so nothing downstream has to re-check they're present.
export type CodemodRegistryConfig = { mode: "local" } | RemoteCodemodRegistryConfig;

export interface AppConfig {
  llm: LlmConfig;
  codingAgent: CodingAgentConfig;
  github: GithubConfig;
  // Optional in config.json; ConfigLoader fills in { mode: "local" }.
  codemodRegistry: CodemodRegistryConfig;
}
