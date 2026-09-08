import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { InsightsRepository } from "../../../src/mcp/db/insights-repository.ts";

const REPO = "/repos/a";

function seed(): Database {
  const db = new Database(":memory:");
  const connection = db.connection;

  const chalk = connection
    .prepare(
      `INSERT INTO packages (repo_path, name, current_version, type)
       VALUES (?, 'chalk', '4.1.0', 'direct') RETURNING id`,
    )
    .get(REPO) as { id: number };
  const unused = connection
    .prepare(
      `INSERT INTO packages (repo_path, name, current_version, type)
       VALUES (?, 'left-pad', '1.0.0', 'transitive') RETURNING id`,
    )
    .get(REPO) as { id: number };

  // Stored absolute, the way Scanner records them.
  connection
    .prepare(
      `INSERT INTO call_sites (package_id, file, line, snippet, api_surface)
       VALUES (?, ?, 12, 'chalk.red(msg)', 'chalk.red')`,
    )
    .run(chalk.id, `${REPO}/src/log.ts`);
  connection
    .prepare(
      `INSERT INTO call_sites (package_id, file, line, snippet, api_surface)
       VALUES (?, ?, 4, 'chalk.yellow(msg)', 'chalk.yellow')`,
    )
    .run(chalk.id, `${REPO}/src/warn.ts`);

  const run = connection
    .prepare(`INSERT INTO release_analysis_runs (status) VALUES ('completed') RETURNING id`)
    .get() as { id: number };
  connection
    .prepare(
      `INSERT INTO release_analysis_results (run_id, package_id, release_tag, is_breaking, summary)
       VALUES (?, ?, 'v5.0.0', 1, 'ESM only, named exports')`,
    )
    .run(run.id, chalk.id);
  connection
    .prepare(
      `INSERT INTO release_analysis_results (run_id, package_id, release_tag, is_breaking, summary)
       VALUES (?, ?, 'v1.1.0', 0, 'No breaking changes')`,
    )
    .run(run.id, unused.id);

  connection
    .prepare(
      `INSERT INTO suggestions
         (repo_path, dependency, package_file, dep_type, current_version, new_version, update_type, datasource)
       VALUES (?, 'chalk', 'package.json', 'dependencies', '4.1.0', '5.0.0', 'major', 'npm')`,
    )
    .run(REPO);

  connection
    .prepare(
      `INSERT INTO change_requests
         (repo_path, package_name, from_version, to_version, summary, status, pr_url)
       VALUES (?, 'chalk', '4.1.0', '5.0.0', 'ESM only', 'pr_opened', 'https://example.test/pr/1')`,
    )
    .run(REPO);

  return db;
}

test("listBreakingChanges returns only breaking releases, with their summaries", () => {
  const insights = new InsightsRepository(seed());

  const breaking = insights.listBreakingChanges({ limit: 50 });

  assert.equal(breaking.length, 1);
  assert.equal(breaking[0].packageName, "chalk");
  assert.equal(breaking[0].releaseTag, "v5.0.0");
  assert.equal(breaking[0].summary, "ESM only, named exports");
});

test("listBreakingChanges filters by package", () => {
  const insights = new InsightsRepository(seed());

  assert.equal(insights.listBreakingChanges({ packageName: "left-pad", limit: 50 }).length, 0);
  assert.equal(insights.listBreakingChanges({ packageName: "chalk", limit: 50 }).length, 1);
});

test("listSuggestions filters by update type", () => {
  const insights = new InsightsRepository(seed());

  assert.equal(insights.listSuggestions({ updateType: "major", limit: 50 }).length, 1);
  assert.equal(insights.listSuggestions({ updateType: "patch", limit: 50 }).length, 0);
});

test("listDependencies counts call sites and puts the busiest first", () => {
  const insights = new InsightsRepository(seed());

  const dependencies = insights.listDependencies({ limit: 50 });

  assert.deepEqual(
    dependencies.map((row) => [row.name, row.callSiteCount]),
    [
      ["chalk", 2],
      ["left-pad", 0],
    ],
  );
});

test("listCallSites finds usages without needing the repo path", () => {
  const insights = new InsightsRepository(seed());

  const callSites = insights.listCallSites({ packageName: "chalk", limit: 50 });

  assert.deepEqual(
    callSites.map((row) => `${row.file}:${row.line}`),
    ["src/log.ts:12", "src/warn.ts:4"],
  );
  assert.equal(callSites[0].apiSurface, "chalk.red");
});

// Absolute paths repeat repoPath on every row - kilobytes of duplicated
// prefix on a real repo, for no added information.
test("listCallSites returns file paths relative to the repo, not absolute", () => {
  const insights = new InsightsRepository(seed());

  const [first] = insights.listCallSites({ packageName: "chalk", limit: 50 });

  assert.equal(first.file, "src/log.ts");
  assert.equal(first.repoPath, REPO);
});

test("listCallSites can be restricted to one repo", () => {
  const insights = new InsightsRepository(seed());

  assert.equal(
    insights.listCallSites({ packageName: "chalk", repoPath: "/repos/other", limit: 50 }).length,
    0,
  );
  assert.equal(
    insights.listCallSites({ packageName: "chalk", repoPath: REPO, limit: 50 }).length,
    2,
  );
});

test("limit caps the number of rows returned", () => {
  const insights = new InsightsRepository(seed());

  assert.equal(insights.listCallSites({ packageName: "chalk", limit: 1 }).length, 1);
});

test("overview summarizes every table the CLI writes", () => {
  const insights = new InsightsRepository(seed());

  const overview = insights.overview();

  assert.deepEqual(overview.repos, [REPO]);
  assert.equal(overview.dependencies, 2);
  assert.equal(overview.callSites, 2);
  assert.equal(overview.suggestions, 1);
  assert.equal(overview.breakingReleases, 1);
  assert.deepEqual(overview.changeRequestsByStatus, { pr_opened: 1 });
  assert.equal(overview.lastReleaseAnalysis?.status, "completed");
});

test("overview on an empty database reports zeroes rather than throwing", () => {
  const insights = new InsightsRepository(new Database(":memory:"));

  const overview = insights.overview();

  assert.deepEqual(overview.repos, []);
  assert.equal(overview.dependencies, 0);
  assert.deepEqual(overview.changeRequestsByStatus, {});
  assert.equal(overview.lastReleaseAnalysis, null);
});
