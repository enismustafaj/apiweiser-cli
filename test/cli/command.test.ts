import assert from "node:assert/strict";
import { test } from "node:test";
import { execute } from "../../src/cli/command.ts";

test("prints a failed command's error as JSON on stdout and exits 1", async (t) => {
  t.mock.method(console, "error", () => {});
  const write = t.mock.method(process.stdout, "write", () => true);
  t.after(() => {
    process.exitCode = 0;
  });

  await execute(
    {
      run: async () => {
        throw new Error("boom");
      },
    },
    {},
  );

  assert.deepEqual(JSON.parse(write.mock.calls[0]!.arguments[0] as string), { error: "boom" });
  assert.equal(process.exitCode, 1);
});
