import { createTask } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { DataSourcesModule } from "./index.ts";

export class Scheduler {
  private readonly dataSources = new DataSourcesModule();
  private readonly task: ScheduledTask;

  constructor(cronExpression: string) {
    this.task = createTask(cronExpression, () => this.run());
  }

  start(): void {
    this.task.start();
  }

  stop(): void {
    this.task.stop();
  }

  private async run(): Promise<void> {
    try {
      await this.dataSources.processPendingLookups();
    } catch (err) {
      console.error("Data sources run failed:", err);
    }
  }
}
