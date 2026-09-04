import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ConfigLoader } from "../../src/config/config-loader.ts";

const createdDirs: string[] = [];

function tempConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-scanner-config-test-"));
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

test("load throws when the config file is missing required fields", () => {
  const configPath = tempConfigPath();
  writeFileSync(configPath, JSON.stringify({ llm: { apiKey: "", url: "", model: "" } }));

  assert.throws(() => new ConfigLoader().load(configPath), /missing llm/);
});

test("load returns the parsed config when it's complete", () => {
  const configPath = tempConfigPath();
  const config = { llm: { apiKey: "sk-test", url: "https://api.openai.com/v1", model: "gpt-5" } };
  writeFileSync(configPath, JSON.stringify(config));

  const result = new ConfigLoader().load(configPath);

  assert.deepEqual(result, config);
});
