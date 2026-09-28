import { createTask } from "node-cron";
import type { ScheduledTask } from "node-cron";
import type {
  CodemodRegistryConfig,
  CodingAgentConfig,
  GithubConfig,
  LlmConfig,
} from "../config/config.ts";
import { SuggestionsModule } from "./index.ts";

export class Scheduler {
  private readonly suggestions: SuggestionsModule;
  private readonly repoPath: string;
  private readonly task: ScheduledTask;

  constructor(
    repoPath: string,
    cronExpression: string,
    llmConfig: LlmConfig,
    codingAgentConfig: CodingAgentConfig,
    githubConfig: GithubConfig,
    codemodRegistryConfig?: CodemodRegistryConfig,
  ) {
    this.suggestions = new SuggestionsModule(
      llmConfig,
      codingAgentConfig,
      githubConfig,
      codemodRegistryConfig,
    );
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
