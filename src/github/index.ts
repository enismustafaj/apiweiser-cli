// See docs/github.md.

import type { GithubConfig } from "../config/config.ts";
import { db } from "../db/singleton.ts";
import { PullRequestsRepository } from "./db/pull-requests-repository.ts";
import { CodemodApplier } from "./tool/codemod-applier.ts";
import { DependencyBumper } from "./tool/dependency-bumper.ts";
import { GitTool } from "./tool/git-tool.ts";
import { PullRequestService } from "./pull-request-service.ts";
import type { PullRequestPackage, PullRequestRequest, PullRequestResult } from "./types.ts";

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
    // Every change request must start from a clean, unmodified default
    // branch - without this, a repo left checked out on a *previous*
    // change request's feature branch (SuggestionsModule.generate() calls
    // this repeatedly against the same repoPath, once per group) means
    // `createBranch` below branches off that PREVIOUS branch instead of
    // the base, silently carrying every prior migration's changes into
    // this one. Found the hard way, running the full pipeline against a
    // real repo: a PR meant to be "upgrade typescript" also contained an
    // unrelated "upgrade concurrently" diff from the change request raised
    // just before it in the same run.
    await this.git.resetToDefaultBranch(request.repoPath);

    // The codemod only migrates call-site syntax - bumping package.json
    // itself is a separate step (see DependencyBumper). One call for every
    // package in the group, not one call per package - see
    // DependencyBumper.bumpAll for why that matters for scope-siblings.
    await this.dependencyBumper.bumpAll(request.repoPath, request.packages);
    await this.codemodApplier.apply(request.codemodPath, request.repoPath);

    // Not a failure - the repo's call sites might not use any API surface
    // that actually changed.
    if (!(await this.git.hasChanges(request.repoPath))) {
      return { created: false, reason: "codemod produced no changes" };
    }

    const remote = await this.git.remoteRepo(request.repoPath);
    if (!remote) {
      return { created: false, reason: "origin remote isn't a GitHub repo" };
    }

    const branch = this.branchName(request.packages);
    await this.git.createBranch(request.repoPath, branch);
    await this.git.commitAll(request.repoPath, this.commitMessage(request.packages));
    await this.git.push(request.repoPath, branch);

    const base = await this.git.defaultBranch(request.repoPath);
    const url = await this.pullRequests.open(remote.owner, remote.repo, {
      title: this.commitMessage(request.packages),
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

  // Multi-package groups are always scope-siblings (see SuggestionsModule §
  // Grouping scoped packages) - the shared scope makes a natural single
  // label, e.g. "@angular", rather than joining every package name.
  private groupLabel(packages: PullRequestPackage[]): string {
    if (packages.length === 1) return packages[0]!.name;
    const first = packages[0]!.name;
    return first.startsWith("@") ? first.split("/")[0]! : packages.map((p) => p.name).join(", ");
  }

  private branchName(packages: PullRequestPackage[]): string {
    const newVersion = packages[0]!.newVersion;
    return `apiweiser-cli/${this.groupLabel(packages)}-${newVersion}`.replace(/[^\w./-]/g, "-");
  }

  private commitMessage(packages: PullRequestPackage[]): string {
    if (packages.length === 1) {
      const pkg = packages[0]!;
      return `Migrate ${pkg.name} from ${pkg.version} to ${pkg.newVersion}`;
    }
    const label = this.groupLabel(packages);
    const names = packages.map((p) => p.name).join(", ");
    return `Migrate ${label} packages together (${names})`;
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
