import OpenAI from "openai";
import type { LlmConfig } from "../../config/config.ts";
import type { Dependency } from "../types.ts";

// Structured output schema so the model's answer is always a single URL,
// not prose we'd have to scrape.
const CHANGELOG_SOURCE_SCHEMA = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description:
        "The single best GitHub URL to fetch this package's release changelog from (its releases page or a raw CHANGELOG.md URL)",
    },
  },
  required: ["url"],
  additionalProperties: false,
} as const;

export class ChangelogSourceAgent {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: LlmConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.url });
    this.model = config.model;
  }

  async findChangelogSource(dependency: Dependency): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "changelog_source",
          strict: true,
          schema: CHANGELOG_SOURCE_SCHEMA,
        },
      },
      messages: [
        {
          role: "user",
          content: `What GitHub URL should be used to fetch the release changelog for the npm package "${dependency.name}"? Find its GitHub repository and answer with its releases page (e.g. https://github.com/<owner>/<repo>/releases) or a raw CHANGELOG.md URL from that repository.`,
        },
      ],
    });

    const choice = response.choices[0];
    if (!choice) {
      throw new Error(`ChangelogSourceAgent: no response for "${dependency.name}"`);
    }
    if (choice.finish_reason === "content_filter" || choice.message.refusal) {
      throw new Error(
        `ChangelogSourceAgent: model refused for "${dependency.name}": ${choice.message.refusal ?? "content filtered"}`,
      );
    }
    if (!choice.message.content) {
      throw new Error(`ChangelogSourceAgent: empty response for "${dependency.name}"`);
    }

    const parsed = JSON.parse(choice.message.content) as { url: string };
    return parsed.url;
  }
}
