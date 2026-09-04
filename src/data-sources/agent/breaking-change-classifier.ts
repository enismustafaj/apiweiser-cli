// Classifies a release's changelog text as breaking or not, via an LLM
// with a structured-output schema so the answer is always
// { isBreaking: boolean, summary: string } - never prose to parse.

import OpenAI from "openai";
import type { LlmConfig } from "../../config/config.ts";
import type { BreakingChangeClassification } from "../types.ts";

const CLASSIFICATION_SCHEMA = {
  type: "object",
  properties: {
    isBreaking: {
      type: "boolean",
      description: "Whether this release note describes a breaking change",
    },
    summary: {
      type: "string",
      description: "One or two sentences on what changed and why it is or isn't breaking",
    },
  },
  required: ["isBreaking", "summary"],
  additionalProperties: false,
} as const;

export class BreakingChangeClassifierAgent {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.url });
    this.model = config.model;
  }

  async classify(releaseNotes: string): Promise<BreakingChangeClassification> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "breaking_change_classification",
          strict: true,
          schema: CLASSIFICATION_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `Does the following release's changelog text describe breaking changes? Base your answer only on the text given.\n\n${releaseNotes}`,
        },
      ],
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error("BreakingChangeClassifierAgent: no response");
    }
    if (choice.finish_reason === "content_filter" || choice.message.refusal) {
      throw new Error(
        `BreakingChangeClassifierAgent: model refused: ${choice.message.refusal ?? "content filtered"}`,
      );
    }
    if (!choice.message.content) {
      throw new Error("BreakingChangeClassifierAgent: empty response");
    }

    return JSON.parse(choice.message.content) as BreakingChangeClassification;
  }
}
