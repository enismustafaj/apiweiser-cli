import assert from "node:assert/strict";
import { test } from "node:test";
import { Scheduler } from "../../src/jobs/scheduler.ts";
import type { Job } from "../../src/jobs/scheduler.ts";

// The suggestions job depends on the changelog lookup job having run first,
// so order is part of the contract - and one job failing mustn't stop the
// rest or reject runAll() (that would kill `scan --once` and the cron tick).
test("runAll runs jobs in order, one at a time, past a failing job", async () => {
  const log: string[] = [];
  const job = (name: string, fail = false): Job => ({
    name,
    async run() {
      log.push(`${name} start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`${name} end`);
      if (fail) throw new Error(`${name} broke`);
    },
  });

  await new Scheduler("0 0 * * *", [job("first", true), job("second")]).runAll();

  assert.deepEqual(log, ["first start", "first end", "second start", "second end"]);
});
