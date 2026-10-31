import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CodemodRegistry } from "../../../../src/change-requests/registry/codemod-registry.ts";
import { CodemodSearch } from "../../../../src/change-requests/registry/codemod-search.ts";
import { CodemodCommand } from "../../../../src/cli/commands/codemod/codemod-command.ts";
import { Database } from "../../../../src/db/database.ts";
import { DependenciesRepository } from "../../../../src/dependencies/db/dependencies-repository.ts";

const REPO = "/repos/a";

function scannedDb(): Database {
  const db = new Database(":memory:");
  const repository = new DependenciesRepository(db);
  repository.upsert(
    REPO,
    [
      { name: "react", currentVersion: "18.3.1" },
      { name: "react-dom", currentVersion: "18.3.1" },
      { name: "zod", currentVersion: "3.23.8" },
    ].map((d) => ({ ...d, type: "direct" as const, isDevDependency: false })),
  );
  repository.insertCallSites(REPO, [
    { dependency: "react", file: "a.tsx", line: 1, snippet: "", apiSurface: "useState" },
    { dependency: "zod", file: "b.ts", line: 2, snippet: "", apiSurface: "z.object" },
  ]);
  return db;
}

test("gives each used package its registry dir, whether a codemod is there, and an exact remote match", async (t) => {
  const registryDir = mkdtempSync(join(tmpdir(), "apiweiser-codemods-"));
  const registry = new CodemodRegistry(registryDir);
  const dirFor = registry.dirFor.bind(registry);
  mkdirSync(dirFor("react", "18.3.1", "19.0.0"), { recursive: true });
  writeFileSync(join(dirFor("react", "18.3.1", "19.0.0"), "codemod.yaml"), "");
  t.mock.method(CodemodRegistry.prototype, "dirFor", dirFor);
  const findExact = t.mock.method(CodemodSearch.prototype, "findExact", async (name: string) =>
    name === "react-18-to-19" ? "@apiweiser/react-18-to-19@1.2.0" : null,
  );

  const result = await new CodemodCommand(scannedDb()).run({
    path: REPO,
    group: "react@19.0.0+react-dom@19.0.0+zod@4.0.0",
  });

  assert.deepEqual(result.packages, [
    {
      name: "react",
      from: "18.3.1",
      to: "19.0.0",
      callSites: 1,
      remote: "@apiweiser/react-18-to-19@1.2.0",
      codemodDir: join(registryDir, "react", "18_to_19"),
      hasCodemod: true,
    },
    {
      name: "react-dom",
      from: "18.3.1",
      to: "19.0.0",
      callSites: 0,
      remote: null,
      codemodDir: null,
      hasCodemod: false,
    },
    {
      name: "zod",
      from: "3.23.8",
      to: "4.0.0",
      callSites: 1,
      remote: null,
      codemodDir: join(registryDir, "zod", "3_to_4"),
      hasCodemod: false,
    },
  ]);
  assert.deepEqual(
    findExact.mock.calls.map((call) => call.arguments),
    [
      ["react-18-to-19", "apiweiser"],
      ["zod-3-to-4", "apiweiser"],
    ],
    "packages without call sites aren't searched",
  );
});

test("a failed search is reported on that package, the codemod dir still comes back", async (t) => {
  t.mock.method(CodemodSearch.prototype, "findExact", async () => {
    throw new Error("network down");
  });

  const [react] = (await new CodemodCommand(scannedDb()).run({ path: REPO, group: "react@19.0.0" }))
    .packages;

  assert.equal(react!.error, "network down");
  assert.ok(react!.codemodDir);
});
