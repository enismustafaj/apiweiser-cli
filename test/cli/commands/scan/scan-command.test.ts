import assert from "node:assert/strict";
import { test } from "node:test";
import { ScanCommand } from "../../../../src/cli/commands/scan/scan-command.ts";
import { Database } from "../../../../src/db/database.ts";
import { DependenciesRepository } from "../../../../src/dependencies/db/dependencies-repository.ts";
import { SbomTool } from "../../../../src/dependencies/sbom/sbom-tool.ts";
import { Scanner } from "../../../../src/dependencies/scanner/scanner.ts";
import type { CallSite, Dependency } from "../../../../src/dependencies/types.ts";

const REPO = "/repos/a";

const commander: Dependency = {
  name: "commander",
  currentVersion: "15.0.0",
  type: "direct",
  isDevDependency: false,
};
const zod: Dependency = {
  name: "zod",
  currentVersion: "3.23.8",
  type: "direct",
  isDevDependency: false,
};
const typescript: Dependency = {
  name: "typescript",
  currentVersion: "5.9.2",
  type: "direct",
  isDevDependency: true,
};
const lodash: Dependency = {
  name: "lodash",
  currentVersion: "4.17.21",
  type: "transitive",
  isDevDependency: false,
};

const commanderSite: CallSite = {
  dependency: "commander",
  file: "src/main.ts",
  line: 4,
  snippet: "new Command()",
  apiSurface: "Command",
};
const zodSite: CallSite = {
  dependency: "zod",
  file: "src/config.ts",
  line: 9,
  snippet: "z.object({})",
  apiSurface: "z.object",
};

// zod is unchanged since an earlier scan, so it isn't rescanned - its call
// sites must still come back, read from the db.
test("lists direct dependencies by name, with call sites from this scan and earlier ones", async (t) => {
  const db = new Database(":memory:");
  const repository = new DependenciesRepository(db);
  repository.upsert(REPO, [{ ...zod }]);
  repository.insertCallSites(REPO, [zodSite]);

  t.mock.method(SbomTool.prototype, "generate", async () => [commander, zod, typescript, lodash]);
  const findCallSites = t.mock.method(Scanner.prototype, "findCallSites", async () => [
    commanderSite,
  ]);

  const result = await new ScanCommand(db).run({ path: REPO });

  assert.deepEqual(
    findCallSites.mock.calls[0]!.arguments[1].map((d: Dependency) => d.name),
    ["commander", "lodash"],
    "only changed runtime dependencies are scanned",
  );
  assert.deepEqual(result, {
    repo: REPO,
    packages: [
      {
        name: "commander",
        version: "15.0.0",
        dev: false,
        callSites: [{ api: "Command", file: "src/main.ts", line: 4 }],
      },
      { name: "typescript", version: "5.9.2", dev: true, callSites: [] },
      {
        name: "zod",
        version: "3.23.8",
        dev: false,
        callSites: [{ api: "z.object", file: "src/config.ts", line: 9 }],
      },
    ],
  });
});
