import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ChangelogSourcesRepository } from "../../../../src/changelogs/db/changelog-sources-repository.ts";
import { GitHubReleaseFetcher } from "../../../../src/changelogs/github-release-fetcher.ts";
import { NpmRegistryLookup } from "../../../../src/changelogs/npm-registry-lookup.ts";
import { ChangelogCommand } from "../../../../src/cli/commands/changelog/changelog-command.ts";
import { Database } from "../../../../src/db/database.ts";
import { DependenciesRepository } from "../../../../src/dependencies/db/dependencies-repository.ts";

const REPO = "/repos/a";
// homedir() follows HOME, so the notes land in a temp dir, not the real ~/.apiweiser-cli.
const HOME = mkdtempSync(join(tmpdir(), "apiweiser-changelog-"));
process.env.HOME = HOME;

const REACT_RELEASES = "https://api.github.com/repos/facebook/react/releases";

function scannedDb(): Database {
  const db = new Database(":memory:");
  new DependenciesRepository(db).upsert(
    REPO,
    [
      { name: "react", currentVersion: "18.3.1" },
      { name: "@scope/no-repo", currentVersion: "1.0.0" },
    ].map((d) => ({ ...d, type: "direct" as const, isDevDependency: false })),
  );
  return db;
}

test("looks up a missing source on npm, saves it, and returns the releases in range", async (t) => {
  const db = scannedDb();
  const lookup = t.mock.method(NpmRegistryLookup.prototype, "findChangelogSource", async (name) =>
    name === "react" ? REACT_RELEASES : null,
  );
  const fetchRange = t.mock.method(GitHubReleaseFetcher.prototype, "fetchRange", async () => [
    { tagName: "v19.0.0", body: "Breaking: ..." },
  ]);

  const result = await new ChangelogCommand(db).run({
    path: REPO,
    group: "@scope/no-repo@2.0.0+react@19.0.0",
  });

  const file = join(HOME, ".apiweiser-cli", "changelogs", "react@18.3.1..19.0.0.md");
  assert.deepEqual(result, {
    repo: REPO,
    packages: [
      {
        name: "@scope/no-repo",
        from: "1.0.0",
        to: "2.0.0",
        source: null,
        releases: 0,
        file: null,
      },
      {
        name: "react",
        from: "18.3.1",
        to: "19.0.0",
        source: "https://github.com/facebook/react",
        releases: 1,
        file,
      },
    ],
  });
  assert.equal(
    readFileSync(file, "utf8"),
    "# react 18.3.1 → 19.0.0\n\n" +
      "Source: https://github.com/facebook/react\n\n" +
      "## v19.0.0\n" +
      "https://github.com/facebook/react/releases/tag/v19.0.0\n\n" +
      "Breaking: ...\n",
  );
  assert.deepEqual(fetchRange.mock.calls[0]!.arguments, [REACT_RELEASES, "18.3.1", "19.0.0"]);
  assert.equal(new ChangelogSourcesRepository(db).findUrl("react"), REACT_RELEASES);

  await new ChangelogCommand(db).run({ path: REPO, group: "react@19.0.0" });
  assert.equal(lookup.mock.callCount(), 2, "a saved source isn't looked up again");
});

test("a release's own headings go under its tag heading, code blocks untouched", async (t) => {
  t.mock.method(NpmRegistryLookup.prototype, "findChangelogSource", async () => REACT_RELEASES);
  t.mock.method(GitHubReleaseFetcher.prototype, "fetchRange", async () => [
    {
      tagName: "v19.0.0",
      body: "# Big release\n## What's Changed\n```sh\n# install it\nnpm i react\n```\n###### Deep",
    },
  ]);

  const [react] = (
    await new ChangelogCommand(scannedDb()).run({ path: REPO, group: "react@19.0.0" })
  ).packages;

  assert.match(
    readFileSync(react!.file!, "utf8"),
    /## v19\.0\.0\n.*\n\n### Big release\n#### What's Changed\n```sh\n# install it\nnpm i react\n```\n###### Deep\n$/,
  );
});

test("a failed fetch is reported on that package instead of failing the command", async (t) => {
  t.mock.method(NpmRegistryLookup.prototype, "findChangelogSource", async () => REACT_RELEASES);
  t.mock.method(GitHubReleaseFetcher.prototype, "fetchRange", async () => {
    throw new Error("GitHub API returned 403");
  });

  const [react] = (
    await new ChangelogCommand(scannedDb()).run({ path: REPO, group: "react@19.0.0" })
  ).packages;

  assert.equal(react!.source, "https://github.com/facebook/react");
  assert.equal(react!.error, "GitHub API returned 403");
  assert.equal(react!.file, null);
});

test("refuses a package the repo's scan didn't record", async () => {
  await assert.rejects(
    new ChangelogCommand(scannedDb()).run({ path: REPO, group: "zod@4.0.0" }),
    /"zod" isn't a dependency of \/repos\/a - check the name/,
  );
});
