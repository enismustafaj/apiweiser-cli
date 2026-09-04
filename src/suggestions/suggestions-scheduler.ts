// Runs SuggestionsModule.generate on a cron schedule.

import { createTask } from "node-cron";
import type { ScheduledTask } from "node-cron";
import { SuggestionsModule } from "./index.ts";

export class Scheduler {
  private readonly suggestions = new SuggestionsModule();
  private readonly repoPath: string;
  private readonly task: ScheduledTask;

  constructor(repoPath: string, cronExpression: string) {
    this.repoPath = repoPath;
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
      await this.suggestions.generate(this.repoPath);
    } catch (err) {
      console.error("Suggestions run failed:", err);
    }
  }
}
