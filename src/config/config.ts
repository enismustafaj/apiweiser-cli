export interface LlmConfig {
  apiKey: string;
  url: string;
  model: string;
}

export interface CodemodAgentConfig {
  command: string;
  args?: string[];
}

export interface AppConfig {
  llm: LlmConfig;
  codemodAgent?: CodemodAgentConfig;
}
