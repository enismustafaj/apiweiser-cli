// Points the agent at a local http server instead of a real LLM provider -
// no mocking of the openai package itself, just a stand-in for
// api.openai.com that returns canned chat-completion responses.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { BreakingChangeClassifierAgent } from "../../../src/data-sources/agent/breaking-change-classifier.ts";

let server: Server;
let baseUrl: string;
let nextResponseBody: unknown;

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(nextResponseBody));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  }
});

after(() => {
  server.close();
});

function agent(): BreakingChangeClassifierAgent {
  return new BreakingChangeClassifierAgent({ apiKey: "test", url: baseUrl, model: "test-model" });
}

function completion(message: Record<string, unknown>, finishReason = "stop") {
  return {
    id: "1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      { index: 0, finish_reason: finishReason, message: { role: "assistant", ...message } },
    ],
  };
}

test("classify parses the structured JSON response", async () => {
  nextResponseBody = completion({
    content: JSON.stringify({ isBreaking: true, summary: "removed the callback API" }),
  });

  const result = await agent().classify("BREAKING CHANGE: removed callbacks");

  assert.deepEqual(result, { isBreaking: true, summary: "removed the callback API" });
});

test("classify throws when the model refuses", async () => {
  nextResponseBody = completion({ content: null, refusal: "cannot help with that" });

  await assert.rejects(() => agent().classify("some release notes"));
});

test("classify throws on a content_filter finish reason", async () => {
  nextResponseBody = completion({ content: null }, "content_filter");

  await assert.rejects(() => agent().classify("some release notes"));
});

test("classify throws on an empty response", async () => {
  nextResponseBody = completion({ content: "" });

  await assert.rejects(() => agent().classify("some release notes"));
});

test("classify throws when there are no choices at all", async () => {
  nextResponseBody = {
    id: "1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [],
  };

  await assert.rejects(() => agent().classify("some release notes"));
});
