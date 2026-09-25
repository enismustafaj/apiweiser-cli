import assert from "node:assert/strict";
import { test } from "node:test";
import { ChangeRequestsModule } from "../../src/change-requests/index.ts";
import type { ChangeRequestInput } from "../../src/change-requests/types.ts";

const UNREACHABLE_CODING_AGENT = { command: "false", args: [] };
const FAKE_GITHUB = { token: "fake-token-for-tests" };

function inputWithCallSites(
  callSites: ChangeRequestInput["callSites"],
  isDevDependency = false,
): ChangeRequestInput {
  return {
    repoPath: "/repos/a",
    packages: [{ name: "some-pkg", version: "1.0.0", newVersion: "2.0.0" }],
    callSites,
    isDevDependency,
    summary: "breaking release",
  };
}

test("create skips the coding agent entirely and opens no PR when there are no call sites", async () => {
  const module = new ChangeRequestsModule(UNREACHABLE_CODING_AGENT, FAKE_GITHUB);

  const result = await module.create(inputWithCallSites([]));

  assert.deepEqual(result, { success: true, codemodPath: "" });
});

// A devDependency has no call sites by design (see DependenciesModule.scan)
// - unlike a real dependency with none, that's not a reason to skip.
test("create still invokes the coding agent for a devDependency with no call sites", async () => {
  const module = new ChangeRequestsModule(UNREACHABLE_CODING_AGENT, FAKE_GITHUB);

  const result = await module.create(inputWithCallSites([], true));

  // UNREACHABLE_CODING_AGENT ("false") always exits non-zero - proves the
  // agent was actually invoked (a real failure, not the early-return path).
  assert.equal(result.success, false);
});
