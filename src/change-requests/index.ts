// Turns a breaking package update into a change request: asks a configured
// coding agent to build and validate a codemod package for it (see
// docs/change-requests.md), storing the result in the local codemod
// registry either way (a failed attempt's package directory is still worth
// keeping around for a human to pick up). On success, applies the codemod
// to the real repo and opens a PR for it (see docs/github.md).

import type { CodingAgentConfig, GithubConfig } from "../config/config.ts";
import { CodingAgentService } from "./agent/coding-agent-service.ts";
import { db } from "../db/singleton.ts";
import { ChangeRequestsRepository } from "./db/change-requests-repository.ts";
import { GithubModule } from "../github/index.ts";
import type { ChangeRequestInput, ChangeRequestRecord, CodemodResult } from "./types.ts";

export class ChangeRequestsModule {
  private readonly codingAgentService: CodingAgentService;
  private readonly github: GithubModule;
  private readonly changeRequests = new ChangeRequestsRepository(db);

  constructor(codingAgentConfig: CodingAgentConfig, githubConfig: GithubConfig) {
    this.codingAgentService = new CodingAgentService(codingAgentConfig);
    this.github = new GithubModule(githubConfig);
  }

  async create(input: ChangeRequestInput): Promise<CodemodResult> {
    // Always asks the agent, even when a codemod already exists at the
    // registry path for this exact upgrade (see CodingAgentService's
    // prompt) - a pure existence check can't tell whether the existing
    // one actually covers this repo's call sites. Found the hard way: the
    // first chalk codemod, built from one repo's call sites, didn't handle
    // a second repo's import style at all - blindly reusing it would have
    // silently produced zero changes there instead of the real fix. The
    // agent inspects what's already there (if anything) and decides
    // whether to reuse, extend, or rebuild.
    const result = await this.codingAgentService.generateCodemod(input);
    if (!result.success) {
      console.error(
        `ChangeRequestsModule: codemod generation failed for "${input.packageName}" ${input.version} -> ${input.newVersion}: ${result.reason}`,
      );
      this.record(input, {
        status: "codemod_failed",
        detail: result.reason,
        codemodPath: result.codemodPath,
      });
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
        this.record(input, {
          status: "pr_opened",
          codemodPath: result.codemodPath,
          prUrl: pr.url,
        });
      } else {
        console.log(`ChangeRequestsModule: no PR opened for "${input.packageName}": ${pr.reason}`);
        this.record(input, {
          status: "skipped",
          detail: pr.reason,
          codemodPath: result.codemodPath,
        });
      }
    } catch (err) {
      console.error(`ChangeRequestsModule: PR creation failed for "${input.packageName}":`, err);
      this.record(input, {
        status: "pr_failed",
        detail: err instanceof Error ? err.message : String(err),
        codemodPath: result.codemodPath,
      });
    }

    return result;
  }

  // Recording is best-effort: a change request that actually produced a PR
  // shouldn't be reported as failed just because writing the audit row
  // afterwards didn't work.
  private record(
    input: ChangeRequestInput,
    outcome: Pick<ChangeRequestRecord, "status" | "detail" | "codemodPath" | "prUrl">,
  ): void {
    try {
      this.changeRequests.insert({
        repoPath: input.repoPath,
        packageName: input.packageName,
        fromVersion: input.version,
        toVersion: input.newVersion,
        summary: input.summary,
        ...outcome,
      });
    } catch (err) {
      console.error(
        `ChangeRequestsModule: recording outcome failed for "${input.packageName}":`,
        err,
      );
    }
  }
}
