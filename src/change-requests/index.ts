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
    const label = input.packages.map((pkg) => pkg.name).join(", ");

    // A devDependency legitimately has no call sites (see
    // DependenciesModule.scan) - the agent still gets a shot at it, working
    // from the changelog summary alone. For a real dependency, empty call
    // sites means there's nothing to migrate in this repo at all.
    if (input.callSites.length === 0 && !input.isDevDependency) {
      console.log(
        `ChangeRequestsModule: no call sites for "${label}" - skipping, nothing to migrate.`,
      );
      return { success: true, codemodPath: "" };
    }

    const result = await this.codingAgentService.generateCodemod(input);
    if (!result.success) {
      console.error(
        `ChangeRequestsModule: codemod generation failed for "${label}": ${result.reason}`,
      );
      return result;
    }

    try {
      const pr = await this.github.openPullRequestForCodemod({
        repoPath: input.repoPath,
        codemodPath: result.codemodPath,
        packages: input.packages,
        summary: input.summary,
      });

      if (pr.created) {
        console.log(`ChangeRequestsModule: opened PR for "${label}": ${pr.url}`);
      } else {
        console.log(`ChangeRequestsModule: no PR opened for "${label}": ${pr.reason}`);
      }
    } catch (err) {
      console.error(`ChangeRequestsModule: PR creation failed for "${label}":`, err);
    }

    return result;
  }
}
