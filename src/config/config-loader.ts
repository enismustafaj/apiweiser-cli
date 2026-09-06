import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppConfig, CodemodAgentConfig } from "./config.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".apiweiser-cli", "config.json");

const TEMPLATE: AppConfig = {
  llm: {
    apiKey: "",
    url: "https://api.openai.com/v1",
    model: "gpt-5",
  },
};

export class ConfigLoader {
  load(configPath: string = DEFAULT_CONFIG_PATH): AppConfig {
    if (!existsSync(configPath)) {
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, `${JSON.stringify(TEMPLATE, null, 2)}\n`, "utf8");
      throw new Error(
        `No config file found. Created a template at ${configPath} - fill in llm.apiKey and rerun.`,
      );
    }

    const config = JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;
    if (!config.llm?.apiKey || !config.llm?.url || !config.llm?.model) {
      throw new Error(`Config at ${configPath} is missing llm.apiKey, llm.url, or llm.model.`);
    }
    return config;
  }

  // Unlike load(), this doesn't create a template or throw when the config
  // file (or the codemodAgent section) is missing - raising change requests
  // is opt-in, so plain suggestion scanning shouldn't require any config.
  loadCodemodAgentConfig(configPath: string = DEFAULT_CONFIG_PATH): CodemodAgentConfig | undefined {
    if (!existsSync(configPath)) return undefined;
    const config = JSON.parse(readFileSync(configPath, "utf8")) as AppConfig;
    return config.codemodAgent;
  }
}
