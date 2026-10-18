// See docs/github.md.

import { branchName, commitMessage } from "./pr-naming.ts";
import type { GithubConfig } from "../config/config.ts";
import { db } from "../db/singleton.ts";
import { PullRequestsRepository } from "./db/pull-requests-repository.ts";
import { CodemodApplier } from "./tool/codemod-applier.ts";
import { DependencyBumper } from "./tool/dependency-bumper.ts";
import { GitTool } from "./tool/git-tool.ts";
import { PullRequestService } from "./pull-request-service.ts";
import type { PullRequestRequest, PullRequestResult } from "./types.ts";

export class GithubModule {
  private readonly codemodApplier = new CodemodApplier();
  private readonly dependencyBumper = new DependencyBumper();
  private readonly git: GitTool;
  private readonly pullRequests: PullRequestService;
  private readonly pullRequestsRepository = new PullRequestsRepository(db);

  constructor(config: GithubConfig) {
    this.git = new GitTool(config);
    this.pullRequests = new PullRequestService(config);
  }

  async openPullRequestForCodemod(request: PullRequestRequest): Promise<PullRequestResult> {
    await this.git.resetToDefaultBranch(request.repoPath);

    // The codemod only migrates call-site syntax - bumping package.json
    // itself is a separate step (see DependencyBumper). One call for every
    // package in the group, not one call per package - see
    // DependencyBumper.bumpAll for why that matters for scope-siblings.
    await this.dependencyBumper.bumpAll(request.repoPath, request.packages);
    await this.codemodApplier.apply(request.codemodPath, request.repoPath);

    if (!(await this.git.hasChanges(request.repoPath))) {
      return { created: false, reason: "codemod produced no changes" };
    }

    const remote = await this.git.remoteRepo(request.repoPath);
    if (!remote) {
      return { created: false, reason: "origin remote isn't a GitHub repo" };
    }

    const branch = branchName(request.packages);
    await this.git.createBranch(request.repoPath, branch);
    await this.git.commitAll(request.repoPath, commitMessage(request.packages));
    await this.git.push(request.repoPath, branch);

    const base = await this.git.defaultBranch(request.repoPath);
    const url = await this.pullRequests.open(remote.owner, remote.repo, {
      title: commitMessage(request.packages),
      head: branch,
      base,
      body: this.buildDescription(request),
    });

    for (const pkg of request.packages) {
      this.pullRequestsRepository.insert({
        repoPath: request.repoPath,
        packageName: pkg.name,
        version: pkg.version,
        newVersion: pkg.newVersion,
        url,
      });
    }

    return { created: true, url };
  }

  private buildDescription(request: PullRequestRequest): string {
    const versionList = request.packages
      .map((pkg) => `- \`${pkg.name}\`: ${pkg.version} -> ${pkg.newVersion}`)
      .join("\n");

    return `Automated migration for:

${versionList}

generated and tested by apiweiser-cli's coding agent.

The codemod package that produced this change lives at \`${request.codemodPath}\`.

## Changelog summary

${request.summary}
`;
  }
}
