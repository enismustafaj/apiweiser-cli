// Turns a successfully-generated codemod into an actual PR against the
// repo being monitored: apply the codemod's workflow to the real repo,
// and - only if it actually changed anything - branch, commit, push, and
// open a PR describing the migration. See docs/github.md.

import type { GithubConfig } from "../config/config.ts";
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

  constructor(config: GithubConfig) {
    this.git = new GitTool(config);
    this.pullRequests = new PullRequestService(config);
  }

  async openPullRequestForCodemod(request: PullRequestRequest): Promise<PullRequestResult> {
    // The codemod's transform only migrates call-site syntax - bumping the
    // dependency itself (package.json + lockfile) is a separate,
    // deterministic step (see DependencyBumper). Skipping it left a real PR
    // that migrated to chalk v5's API while still declaring ^4.1.0 - source
    // that referenced named exports that don't exist in the installed v4.
    await this.dependencyBumper.bump(request.repoPath, request.packageName, request.newVersion);
    await this.codemodApplier.apply(request.codemodPath, request.repoPath);

    // A codemod applying cleanly but touching nothing isn't a failure -
    // e.g. the repo's real call sites might only use API surface that
    // didn't actually change (see docs/change-requests.md). Nothing to
    // open a PR about either way.
    if (!(await this.git.hasChanges(request.repoPath))) {
      return { created: false, reason: "codemod produced no changes" };
    }

    const remote = await this.git.remoteRepo(request.repoPath);
    if (!remote) {
      return { created: false, reason: "origin remote isn't a GitHub repo" };
    }

    const branch = this.branchName(request.packageName, request.newVersion);
    await this.git.createBranch(request.repoPath, branch);
    await this.git.commitAll(
      request.repoPath,
      `Migrate ${request.packageName} ${request.version} -> ${request.newVersion}`,
    );
    await this.git.push(request.repoPath, branch);

    const base = await this.git.defaultBranch(request.repoPath);
    const url = await this.pullRequests.open(remote.owner, remote.repo, {
      title: `Migrate ${request.packageName} from ${request.version} to ${request.newVersion}`,
      head: branch,
      base,
      body: this.buildDescription(request),
    });

    return { created: true, url };
  }

  private branchName(packageName: string, newVersion: string): string {
    return `apiweiser-cli/${packageName}-${newVersion}`.replace(/[^\w./-]/g, "-");
  }

  private buildDescription(request: PullRequestRequest): string {
    return `Automated migration for \`${request.packageName}\` ${request.version} -> ${request.newVersion}, generated and tested by apiweiser-cli's coding agent.

The codemod package that produced this change lives at \`${request.codemodPath}\`.

## Changelog summary

${request.summary}
`;
  }
}
