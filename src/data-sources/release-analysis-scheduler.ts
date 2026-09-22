import { createTask } from "node-cron";
import type { ScheduledTask } from "node-cron";
import type { GithubConfig, LlmConfig } from "../config/config.ts";
import { ReleaseAnalysisModule } from "./release-analysis.ts";

export class Scheduler {
  private readonly releaseAnalysis: ReleaseAnalysisModule;
  private readonly task: ScheduledTask;

  constructor(cronExpression: string, llmConfig: LlmConfig, githubConfig?: GithubConfig) {
    this.releaseAnalysis = new ReleaseAnalysisModule(llmConfig, githubConfig);
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
      await this.releaseAnalysis.run();
    } catch (err) {
      console.error("Release analysis run failed:", err);
    }
  }
}
