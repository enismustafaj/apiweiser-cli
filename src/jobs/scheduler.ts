// See docs/jobs.md.

import { createTask } from "node-cron";
import { logger } from "../logger.ts";

const log = logger("jobs");

// One unit of background work - what to run, kept separate from when
// (Scheduler) so the same job runs on a cron or once, unchanged.
export interface Job {
  name: string;
  run(): Promise<void>;
}

export class Scheduler {
  private readonly cronExpression: string;
  private readonly jobs: Job[];

  constructor(cronExpression: string, jobs: Job[]) {
    this.cronExpression = cronExpression;
    this.jobs = jobs;
  }

  start(): void {
    createTask(this.cronExpression, () => this.runAll()).start();
  }

  // In order, one at a time - a later job can depend on an earlier one
  // (suggestions summarize changelogs from sources the lookup job found).
  // One job failing is logged, not thrown, so the rest still run and the
  // schedule survives.
  async runAll(): Promise<void> {
    for (const job of this.jobs) {
      const startedAt = Date.now();
      log.info(`${job.name} job started`);
      try {
        await job.run();
        log.info(`${job.name} job finished in ${seconds(startedAt)}s`);
      } catch (err) {
        log.error(`${job.name} job failed after ${seconds(startedAt)}s:`, err);
      }
    }
  }
}

function seconds(since: number): string {
  return ((Date.now() - since) / 1000).toFixed(1);
}
