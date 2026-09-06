import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".apiweiser-cli", "config.json");

const TEMPLATE: AppConfig = {
  llm: {
    apiKey: "",
    url: "https://api.openai.com/v1",
    model: "gpt-5",
  },
  codingAgent: {
    command: "claude",
    args: ["-p"],
  },
  github: {
    token: "",
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
    if (!config.codingAgent?.command) {
      throw new Error(`Config at ${configPath} is missing codingAgent.command.`);
    }
    if (!config.github?.token) {
      throw new Error(`Config at ${configPath} is missing github.token.`);
    }
    return config;
  }
}
