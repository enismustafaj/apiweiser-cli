import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AppConfig } from "./config.ts";

const DEFAULT_CONFIG_PATH = join(homedir(), ".apiweiser-cli", "config.json");

// config.json as written by hand - codemodRegistry may be absent, and its
// fields aren't trusted until checked below.
type RawConfig = Omit<AppConfig, "codemodRegistry"> & {
  codemodRegistry?: { mode?: string; scope?: string; apiKey?: string };
};

const TEMPLATE: RawConfig = {
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

    const config = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
    if (!config.llm?.apiKey || !config.llm?.url || !config.llm?.model) {
      throw new Error(`Config at ${configPath} is missing llm.apiKey, llm.url, or llm.model.`);
    }
    if (!config.codingAgent?.command) {
      throw new Error(`Config at ${configPath} is missing codingAgent.command.`);
    }
    if (!config.github?.token) {
      throw new Error(`Config at ${configPath} is missing github.token.`);
    }

    const registry = config.codemodRegistry ?? { mode: "local" };
    if (registry.mode === "local") {
      return { ...config, codemodRegistry: { mode: "local" } };
    }
    if (registry.mode !== "remote") {
      throw new Error(
        `Config at ${configPath} has codemodRegistry.mode: "${registry.mode}" - ` +
          `expected "local" or "remote".`,
      );
    }
    if (!registry.scope || !registry.apiKey) {
      throw new Error(
        `Config at ${configPath} has codemodRegistry.mode: "remote" but is missing ` +
          `codemodRegistry.scope or codemodRegistry.apiKey.`,
      );
    }
    return {
      ...config,
      codemodRegistry: { mode: "remote", scope: registry.scope, apiKey: registry.apiKey },
    };
  }
}
