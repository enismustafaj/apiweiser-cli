import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeRequestsModule } from "../../src/change-requests/index.ts";
import type { ChangeRequestInput } from "../../src/change-requests/types.ts";

const UNREACHABLE_CODING_AGENT = { command: "false", args: [] };
const FAKE_GITHUB = { token: "fake-token-for-tests" };

function inputWithCallSites(callSites: ChangeRequestInput["callSites"]): ChangeRequestInput {
  return {
    repoPath: "/repos/a",
    packageName: "some-pkg",
    version: "1.0.0",
    newVersion: "2.0.0",
    callSites,
    isBreaking: true,
    summary: "breaking release",
  };
}

test("create skips the coding agent entirely and opens no PR when there are no call sites", async () => {
  const module = new ChangeRequestsModule(UNREACHABLE_CODING_AGENT, FAKE_GITHUB);

  const result = await module.create(inputWithCallSites([]));

  assert.deepEqual(result, { success: true, codemodPath: "" });
});
