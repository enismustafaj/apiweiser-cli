import type { Database } from "../../db/database.ts";

export interface OpenedPullRequest {
  repoPath: string;
  packageName: string;
  version: string;
  newVersion: string;
  url: string;
}

export class PullRequestsRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // One row per PR actually opened - not per attempt (see
  // GithubModule.openPullRequestForCodemod, which returns `created: false`
  // without a URL when there's nothing to record).
  insert(pr: OpenedPullRequest): void {
    this.db.connection
      .prepare(
        `INSERT INTO pull_requests (repo_path, package_name, version, new_version, url)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(pr.repoPath, pr.packageName, pr.version, pr.newVersion, pr.url);
  }
}
