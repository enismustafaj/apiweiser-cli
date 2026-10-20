import type { SuggestionsModule } from "../suggestions/index.ts";
import type { Job } from "./scheduler.ts";

export class SuggestionsJob implements Job {
  readonly name = "Suggestions";
  private readonly suggestions: SuggestionsModule;
  private readonly repoPath: string;

  constructor(suggestions: SuggestionsModule, repoPath: string) {
    this.suggestions = suggestions;
    this.repoPath = repoPath;
  }

  async run(): Promise<void> {
    await this.suggestions.generate(this.repoPath);
  }
}
