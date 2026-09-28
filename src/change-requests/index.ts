import type { CodemodRegistryConfig, CodingAgentConfig, GithubConfig } from "../config/config.ts";
import { CodingAgentService } from "./agent/coding-agent-service.ts";
import { GithubModule } from "../github/index.ts";
import { RemoteCodemodRegistry } from "./registry/remote-codemod-registry.ts";
import type { ChangeRequestInput, CodemodResult } from "./types.ts";

export class ChangeRequestsModule {
  private readonly codingAgentService: CodingAgentService;
  private readonly github: GithubModule;
  private readonly remoteRegistry: RemoteCodemodRegistry;
  private readonly canPublish: boolean;

  constructor(
    codingAgentConfig: CodingAgentConfig,
    githubConfig: GithubConfig,
    codemodRegistryConfig?: CodemodRegistryConfig,
  ) {
    this.codingAgentService = new CodingAgentService(codingAgentConfig, codemodRegistryConfig);
    this.github = new GithubModule(githubConfig);
    this.remoteRegistry = new RemoteCodemodRegistry(codemodRegistryConfig);
    this.canPublish = codemodRegistryConfig?.mode === "remote";
  }

  async create(input: ChangeRequestInput): Promise<CodemodResult> {
    const label = input.packages.map((pkg) => pkg.name).join(", ");

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
        await this.publishIfConfigured(result.codemodPath, label);
      } else {
        console.log(`ChangeRequestsModule: no PR opened for "${label}": ${pr.reason}`);
      }
    } catch (err) {
      console.error(`ChangeRequestsModule: PR creation failed for "${label}":`, err);
    }

    return result;
  }

  private async publishIfConfigured(codemodPath: string, label: string): Promise<void> {
    if (!this.canPublish) return;

    try {
      await this.remoteRegistry.publish(codemodPath);
      console.log(`ChangeRequestsModule: published codemod for "${label}" to the remote registry`);
    } catch (err) {
      console.error(`ChangeRequestsModule: publish failed for "${label}":`, err);
    }
  }
}
