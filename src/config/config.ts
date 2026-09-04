export interface LlmConfig {
  apiKey: string;
  url: string;
  model: string;
}

export interface AppConfig {
  llm: LlmConfig;
}
