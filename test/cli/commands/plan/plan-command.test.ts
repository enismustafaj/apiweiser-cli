import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanCommand } from "../../../../src/cli/commands/plan/plan-command.ts";
import { Database } from "../../../../src/db/database.ts";
import { DependenciesRepository } from "../../../../src/dependencies/db/dependencies-repository.ts";
import { UpgradePlanner } from "../../../../src/suggestions/group-updates.ts";
import { RenovateTool } from "../../../../src/suggestions/tool/renovate-tool.ts";
import type { RenovateUpdate } from "../../../../src/suggestions/types.ts";
import { OsvClient } from "../../../../src/vulnerabilities/osv-client.ts";

const REPO = "/repos/a";

const advisory = {
  id: "GHSA-1111",
  summary: "XSS",
  severity: "HIGH",
  fixedIn: "19.0.1",
};

function update(dependency: string, currentVersion: string, newVersion: string): RenovateUpdate {
  return {
    dependency,
    packageFile: "package.json",
    depType: "dependencies",
    currentVersion,
    newVersion,
    updateType: "major",
    datasource: "npm",
  };
}

const react = update("react", "18.3.1", "19.0.0");
const reactDom = update("react-dom", "18.3.1", "19.0.0");
const zod = update("zod", "3.23.8", "4.0.0");

function scannedDb(): Database {
  const db = new Database(":memory:");
  const repository = new DependenciesRepository(db);
  repository.upsert(
    REPO,
    [
      ["react", "18.2.0"],
      ["react-dom", "18.2.0"],
      ["zod", "3.22.4"],
    ].map(([name, currentVersion]) => ({
      name: name!,
      currentVersion: currentVersion!,
      type: "direct" as const,
      isDevDependency: false,
    })),
  );
  repository.insertCallSites(REPO, [
    { dependency: "react", file: "a.tsx", line: 1, snippet: "", apiSurface: "useState" },
    { dependency: "react", file: "b.tsx", line: 2, snippet: "", apiSurface: "useEffect" },
  ]);
  return db;
}

// The fake scan recorded react at 18.2.0 while Renovate says 18.3.1 - from
// must be the installed version, the one changelog and codemod use too.
test("prints the planner's groups with sorted members, a stable id and call-site counts", async (t) => {
  t.mock.method(RenovateTool.prototype, "run", async () => [reactDom, react, zod]);
  t.mock.method(UpgradePlanner.prototype, "plan", async () => ({
    groups: [[reactDom, react]],
    skipped: [{ dependency: "zod", reason: "peer conflict" }],
  }));
  const findVulnerabilities = t.mock.method(
    OsvClient.prototype,
    "findVulnerabilities",
    async () => new Map([["react", [advisory]]]),
  );

  const result = await new PlanCommand(scannedDb()).run({ path: REPO, packages: [] });

  assert.deepEqual(result, {
    repo: REPO,
    groups: [
      {
        id: "react@19.0.0+react-dom@19.0.0",
        packages: [
          {
            name: "react",
            from: "18.2.0",
            to: "19.0.0",
            updateType: "major",
            callSites: 2,
            vulnerabilities: [advisory],
          },
          {
            name: "react-dom",
            from: "18.2.0",
            to: "19.0.0",
            updateType: "major",
            callSites: 0,
            vulnerabilities: [],
          },
        ],
      },
    ],
    skipped: [{ name: "zod", reason: "peer conflict", vulnerabilities: [] }],
  });
  assert.deepEqual(
    findVulnerabilities.mock.calls[0]!.arguments[0],
    [
      { name: "react-dom", version: "18.2.0" },
      { name: "react", version: "18.2.0" },
      { name: "zod", version: "3.22.4" },
    ],
    "looked up at the installed versions scan recorded, not Renovate's",
  );
});

test("an unreachable OSV leaves vulnerabilities null instead of failing the plan", async (t) => {
  t.mock.method(RenovateTool.prototype, "run", async () => [react]);
  t.mock.method(UpgradePlanner.prototype, "plan", async () => ({
    groups: [[react]],
    skipped: [],
  }));
  t.mock.method(OsvClient.prototype, "findVulnerabilities", async () => {
    throw new Error("OSV returned 503");
  });

  const result = await new PlanCommand(scannedDb()).run({ path: REPO, packages: [] });

  assert.equal(result.groups[0]!.packages[0]!.vulnerabilities, null);
});

test("--package keeps only the groups and skips that mention it", async (t) => {
  t.mock.method(RenovateTool.prototype, "run", async () => [react, reactDom, zod]);
  t.mock.method(UpgradePlanner.prototype, "plan", async () => ({
    groups: [[react, reactDom], [zod]],
    skipped: [{ dependency: "eslint", reason: "peer conflict" }],
  }));
  t.mock.method(OsvClient.prototype, "findVulnerabilities", async () => new Map());

  const result = await new PlanCommand(scannedDb()).run({ path: REPO, packages: ["react-dom"] });

  assert.deepEqual(
    result.groups.map((group) => group.id),
    ["react@19.0.0+react-dom@19.0.0"],
  );
  assert.deepEqual(result.skipped, []);
});

test("refuses a repo that was never scanned, naming it once", async () => {
  await assert.rejects(
    new PlanCommand(new Database(":memory:")).run({ path: REPO, packages: [] }),
    {
      message: "/repos/a hasn't been scanned - run `scan` on it first",
    },
  );
});
