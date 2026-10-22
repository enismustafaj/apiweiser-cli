import type { CodemodRegistryConfig, CodingAgentConfig, GithubConfig } from "../config/config.ts";
import { CodingAgentService } from "./agent/coding-agent-service.ts";
import { GithubModule } from "../github/index.ts";
import { logger } from "../logger.ts";
import { RemoteCodemodRegistry } from "./registry/remote-codemod-registry.ts";
import type { ChangeRequestInput, CodemodResult } from "./types.ts";

const log = logger("change-requests");

export class ChangeRequestsModule {
  private readonly codingAgentService: CodingAgentService;
  private readonly github: GithubModule;
  // Only in remote mode - null means codemods stay local, nothing to publish.
  private readonly remoteRegistry: RemoteCodemodRegistry | null;

  constructor(
    codingAgentConfig: CodingAgentConfig,
    githubConfig: GithubConfig,
    codemodRegistryConfig: CodemodRegistryConfig = { mode: "local" },
  ) {
    this.codingAgentService = new CodingAgentService(codingAgentConfig, codemodRegistryConfig);
    this.github = new GithubModule(githubConfig);
    this.remoteRegistry =
      codemodRegistryConfig.mode === "remote"
        ? new RemoteCodemodRegistry(codemodRegistryConfig)
        : null;
  }

  async create(input: ChangeRequestInput): Promise<CodemodResult> {
    const label = input.packages.map((pkg) => pkg.name).join(", ");

    if (input.callSites.length === 0) {
      log.info(`No call sites for "${label}" - skipping, nothing to migrate.`);
      return { success: true, codemodPath: "" };
    }

    log.info(`Generating codemod for "${label}" (this can take several minutes)`);
    const result = await this.codingAgentService.generateCodemod(input);
    if (!result.success) {
      log.error(`Codemod generation failed for "${label}": ${result.reason}`);
      return result;
    }

    log.info(`Codemod ready at ${result.codemodPath}, opening PR`);
    try {
      const pr = await this.github.openPullRequestForCodemod({
        repoPath: input.repoPath,
        codemodPath: result.codemodPath,
        packages: input.packages,
        summary: input.summary,
      });

      if (pr.created) {
        log.info(`Opened PR for "${label}": ${pr.url}`);
        await this.publishIfConfigured(result.codemodPath, label);
      } else {
        log.info(`No PR opened for "${label}": ${pr.reason}`);
      }
    } catch (err) {
      log.error(`PR creation failed for "${label}":`, err);
    }

    return result;
  }

  private async publishIfConfigured(codemodPath: string, label: string): Promise<void> {
    if (!this.remoteRegistry) return;

    try {
      await this.remoteRegistry.publish(codemodPath);
      log.info(`Published codemod for "${label}" to the remote registry`);
    } catch (err) {
      log.error(`Publish failed for "${label}":`, err);
    }
  }
}
