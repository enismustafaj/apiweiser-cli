// Turns a breaking package update into a change request: asks a configured
// coding agent to build and validate a codemod package for it (see
// docs/change-requests.md), storing the result in the local codemod
// registry either way (a failed attempt's package directory is still worth
// keeping around for a human to pick up). On success, applies the codemod
// to the real repo and opens a PR for it (see docs/github.md).

import type { CodingAgentConfig, GithubConfig } from "../config/config.ts";
import { CodingAgentService } from "./agent/coding-agent-service.ts";
import { GithubModule } from "../github/index.ts";
import type { ChangeRequestInput, CodemodResult } from "./types.ts";

export class ChangeRequestsModule {
  private readonly codingAgentService: CodingAgentService;
  private readonly github: GithubModule;

  constructor(codingAgentConfig: CodingAgentConfig, githubConfig: GithubConfig) {
    this.codingAgentService = new CodingAgentService(codingAgentConfig);
    this.github = new GithubModule(githubConfig);
  }

  async create(input: ChangeRequestInput): Promise<CodemodResult> {
    const result = await this.codingAgentService.generateCodemod(input);
    if (!result.success) {
      console.error(
        `ChangeRequestsModule: codemod generation failed for "${input.packageName}" ${input.version} -> ${input.newVersion}: ${result.reason}`,
      );
      return result;
    }

    try {
      const pr = await this.github.openPullRequestForCodemod({
        repoPath: input.repoPath,
        codemodPath: result.codemodPath,
        packageName: input.packageName,
        version: input.version,
        newVersion: input.newVersion,
        summary: input.summary,
      });

      if (pr.created) {
        console.log(`ChangeRequestsModule: opened PR for "${input.packageName}": ${pr.url}`);
      } else {
        console.log(`ChangeRequestsModule: no PR opened for "${input.packageName}": ${pr.reason}`);
      }
    } catch (err) {
      console.error(`ChangeRequestsModule: PR creation failed for "${input.packageName}":`, err);
    }

    return result;
  }
}
