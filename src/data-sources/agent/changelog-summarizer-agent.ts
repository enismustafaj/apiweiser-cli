import OpenAI from "openai";
import type { LlmConfig } from "../../config/config.ts";
import { TIMEOUT_MS } from "../../http.ts";

export class ChangelogSummarizerAgent {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.url, timeout: TIMEOUT_MS });
    this.model = config.model;
  }

  async summarize(releaseNotes: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "user",
          content: `Summarize what changed in this package upgrade, in a few sentences, for a developer who has to migrate code that depends on it. Call out anything that looks like a breaking change (removed/renamed APIs, changed defaults, new required arguments, dropped support for something). Base your answer only on the text given.\n\n${releaseNotes}`,
        },
      ],
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("ChangelogSummarizerAgent: no response");
    }
    if (choice.finish_reason === "content_filter" || choice.message.refusal) {
      throw new Error(
        `ChangelogSummarizerAgent: model refused: ${choice.message.refusal ?? "content filtered"}`,
      );
    }
    if (!choice.message.content) {
      throw new Error("ChangelogSummarizerAgent: empty response");
    }

    return choice.message.content;
  }
}
