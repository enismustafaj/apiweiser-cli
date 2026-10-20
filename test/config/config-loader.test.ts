import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ConfigLoader } from "../../src/config/config-loader.ts";

const createdDirs: string[] = [];

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-config-test-"));
  createdDirs.push(dir);
  return join(dir, "config.json");
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("load throws and writes a template when the config file doesn't exist", () => {
  const configPath = tempConfigPath();

  assert.throws(() => new ConfigLoader().load(configPath), /Created a template/);

  const written = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(written.llm.apiKey, "");
});

test("load throws when the config file is missing required llm fields", () => {
  const configPath = tempConfigPath();
  writeFileSync(configPath, JSON.stringify({ llm: { apiKey: "", url: "", model: "" } }));

  assert.throws(() => new ConfigLoader().load(configPath), /missing llm/);
});

test("load throws when the config file is missing codingAgent.command", () => {
  const configPath = tempConfigPath();
  writeFileSync(
    configPath,
    JSON.stringify({
      llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    }),
  );

  assert.throws(() => new ConfigLoader().load(configPath), /missing codingAgent.command/);
});

test("load throws when the config file is missing github.token", () => {
  const configPath = tempConfigPath();
  writeFileSync(
    configPath,
    JSON.stringify({
      llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
      codingAgent: { command: "claude", args: ["-p"] },
    }),
  );

  assert.throws(() => new ConfigLoader().load(configPath), /missing github.token/);
});

test("load returns the parsed config when it's complete", () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  const result = new ConfigLoader().load(configPath);

  assert.deepEqual(result, { ...config, codemodRegistry: { mode: "local" } });
});

// codemodRegistry itself stays optional - omitting it means "local" - but
// mode: "remote" is a real, explicit choice to authenticate against and
// publish to an external service, so it has real requirements.
test("load succeeds without codemodRegistry at all", () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.doesNotThrow(() => new ConfigLoader().load(configPath));
});

test('load succeeds with codemodRegistry.mode: "local" and no scope/apiKey', () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
    codemodRegistry: { mode: "local" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.doesNotThrow(() => new ConfigLoader().load(configPath));
});

test('load throws when codemodRegistry.mode is "remote" but scope/apiKey are missing', () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
    codemodRegistry: { mode: "remote" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.throws(
    () => new ConfigLoader().load(configPath),
    /codemodRegistry\.scope or codemodRegistry\.apiKey/,
  );
});

test('load succeeds when codemodRegistry.mode is "remote" with scope and apiKey', () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
    codemodRegistry: { mode: "remote", scope: "my-org", apiKey: "key" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.deepEqual(new ConfigLoader().load(configPath).codemodRegistry, config.codemodRegistry);
});

// Before, any mode other than "remote" silently meant local - a typo like
// "remtoe" would quietly never publish.
test("load throws on an unknown codemodRegistry.mode", () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
    codemodRegistry: { mode: "remtoe", scope: "my-org", apiKey: "key" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.throws(() => new ConfigLoader().load(configPath), /expected "local" or "remote"/);
});

// Stray fields on a local config (e.g. an apiKey kept for switching to
// remote later) are dropped, so nothing downstream sees them.
test('load keeps only mode for codemodRegistry.mode: "local"', () => {
  const configPath = tempConfigPath();
  const config = {
    llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" },
    codingAgent: { command: "claude", args: ["-p"] },
    github: { token: "ghp_test" },
    codemodRegistry: { mode: "local", apiKey: "kept-for-later" },
  };
  writeFileSync(configPath, JSON.stringify(config));

  assert.deepEqual(new ConfigLoader().load(configPath).codemodRegistry, { mode: "local" });
});
