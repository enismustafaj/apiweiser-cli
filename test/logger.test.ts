import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { logger } from "../src/logger.ts";

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

test("prefixes messages with timestamp, level and scope", (t) => {
  const log = t.mock.method(console, "log", () => {});

  logger("jobs").info("started", 3);

  const [prefix, ...rest] = log.mock.calls[0]!.arguments;
  assert.match(prefix, /^\d{4}-\d{2}-\d{2}T\S+Z INFO  \[jobs\]$/);
  assert.deepEqual(rest, ["started", 3]);
});

test("drops debug by default and shows it when LOG_LEVEL=debug", (t) => {
  const log = t.mock.method(console, "log", () => {});

  logger("x").debug("hidden");
  assert.equal(log.mock.callCount(), 0);

  process.env.LOG_LEVEL = "debug";
  logger("x").debug("shown");
  assert.equal(log.mock.callCount(), 1);
});

test("sends warn and error to stderr", (t) => {
  const err = t.mock.method(console, "error", () => {});

  logger("x").warn("w");
  logger("x").error("e");

  assert.equal(err.mock.callCount(), 2);
});

test("falls back to info on an unknown LOG_LEVEL", (t) => {
  const log = t.mock.method(console, "log", () => {});
  process.env.LOG_LEVEL = "verbose";

  logger("x").debug("hidden");
  logger("x").info("shown");

  assert.equal(log.mock.callCount(), 1);
});
