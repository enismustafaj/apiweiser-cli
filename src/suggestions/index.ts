// Suggestions module: runs Renovate via RenovateTool to get proposed
// version updates, and persists them via SuggestionsRepository.
//
import { db } from "../db/singleton.ts";
import { SuggestionsRepository } from "./db/suggestions-repository.ts";
import { RenovateTool } from "./tool/renovate-tool.ts";
import type { RenovateUpdate } from "./types.ts";

export class SuggestionsModule {
  private readonly renovateTool = new RenovateTool();
  private readonly suggestionsRepository = new SuggestionsRepository(db);
  async generate(repoPath: string): Promise<RenovateUpdate[]> {
    const updates = await this.renovateTool.run(repoPath);
    this.suggestionsRepository.insert(updates);

    return updates;
  }
}
