import assert from "node:assert/strict";
import { test } from "node:test";
import { RepositoryVerifier, VerificationFailedError } from "../../src/change-requests/verifier.ts";

test("runs configured verification commands in order", async () => {
  const invocations: string[] = [];
  const verifier = new RepositoryVerifier(async (command, args, cwd) => {
    invocations.push(`${command} ${(args ?? []).join(" ")} in ${cwd}`);
    return { command, args, exitCode: 0, stdout: "ok", stderr: "" };
  });

  const results = await verifier.verify("/tmp/repository", [
    { command: "npm", args: ["run", "build"] },
    { command: "npm", args: ["test"] },
  ]);

  assert.deepEqual(invocations, [
    "npm run build in /tmp/repository",
    "npm test in /tmp/repository",
  ]);
  assert.equal(results.length, 2);
});

test("stops after the first failed verification command", async () => {
  let calls = 0;
  const verifier = new RepositoryVerifier(async (command, args) => {
    calls += 1;
    return { command, args, exitCode: 1, stdout: "", stderr: "tests failed" };
  });

  await assert.rejects(
    verifier.verify("/tmp/repository", [
      { command: "npm", args: ["test"] },
      { command: "npm", args: ["run", "lint"] },
    ]),
    (error) => {
      assert.ok(error instanceof VerificationFailedError);
      assert.equal(error.result.stderr, "tests failed");
      return true;
    },
  );
  assert.equal(calls, 1);
});
