import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Database } from "../../src/db/database.ts";
import { PackagesRepository } from "../../src/dependencies/db/packages-repository.ts";
import { UpgradePlanner } from "../../src/suggestions/group-updates.ts";
import type { RenovateUpdate } from "../../src/suggestions/types.ts";

// The real planner, grouper and lookups - only the outside world is
// replaced: an in-memory database and a stubbed npm registry.
const REPO = "/repos/angular";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// name -> version -> that version's peerDependencies. Anything not listed
// 404s; a name in `failing` returns 503.
type Registry = Record<string, Record<string, Record<string, string>>>;

function stubRegistry(registry: Registry, failing: string[] = []): void {
  globalThis.fetch = (async (url: string | URL) => {
    const name = decodeURIComponent(String(url).replace("https://registry.npmjs.org/", ""));
    if (failing.includes(name)) return new Response("{}", { status: 503 });
    const versions = registry[name];
    if (!versions) return new Response("{}", { status: 404 });
    const doc = {
      versions: Object.fromEntries(
        Object.entries(versions).map(([v, peerDependencies]) => [v, { peerDependencies }]),
      ),
    };
    return new Response(JSON.stringify(doc), { status: 200 });
  }) as typeof fetch;
}

// A registry where every proposed version exists and has no peers.
function registryWithoutPeers(updates: RenovateUpdate[]): Registry {
  const registry: Registry = {};
  for (const u of updates)
    registry[u.dependency] = { ...registry[u.dependency], [u.newVersion]: {} };
  return registry;
}

function planner(installed: [string, string][] = []): UpgradePlanner {
  const packages = new PackagesRepository(new Database(":memory:"));
  packages.upsert(
    REPO,
    installed.map(([name, currentVersion]) => ({
      name,
      currentVersion,
      type: "direct" as const,
      isDevDependency: false,
    })),
  );
  return UpgradePlanner.forRepo(REPO, packages);
}

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

function versions(group: RenovateUpdate[]): string[] {
  return group.map((u) => `${u.dependency}@${u.newVersion}`);
}

async function picked(updates: RenovateUpdate[], dependency: string): Promise<string | undefined> {
  stubRegistry(registryWithoutPeers(updates));
  const plan = await planner().plan(updates);
  return plan.groups.flat().find((u) => u.dependency === dependency)?.newVersion;
}

// --- next leap: one version per package -------------------------------------

// Real bug, found running the full pipeline against a real repo: Renovate
// proposed both "@angular/forms"@5.2.9->5.2.11 (patch) and @5.2.9->22.2.0
// (major) as separate rows, and both landed in the same install command.
test("plans one version per package", async () => {
  const updates = [
    update("@angular/forms", "5.2.9", "5.2.11"),
    update("@angular/forms", "5.2.9", "22.2.0"),
    update("rxjs", "5.5.7", "5.5.12"),
    update("rxjs", "5.5.7", "7.8.2"),
  ];
  stubRegistry(registryWithoutPeers(updates));

  const plan = await planner().plan(updates);

  assert.deepEqual(plan.groups.map(versions), [["@angular/forms@22.2.0"], ["rxjs@7.8.2"]]);
});

test("picks the next major, not the latest one", async () => {
  const updates = [
    update("@angular/forms", "5.2.9", "7.2.0"),
    update("@angular/forms", "5.2.9", "5.2.11"),
    update("@angular/forms", "5.2.9", "6.1.10"),
  ];

  assert.equal(await picked(updates, "@angular/forms"), "6.1.10");
});

test("picks the highest candidate when none crosses a major", async () => {
  const updates = [update("chalk", "5.0.0", "5.3.0"), update("chalk", "5.0.0", "5.1.0")];

  assert.equal(await picked(updates, "chalk"), "5.3.0");
});

test("ignores a candidate whose version can't be parsed", async () => {
  const updates = [update("pkg", "1.0.0", "not-a-version"), update("pkg", "1.0.0", "2.0.0")];

  assert.equal(await picked(updates, "pkg"), "2.0.0");
});

// --- peer groups --------------------------------------------------------------

test("groups a package with the peer its new version needs, at the lowest fitting version", async () => {
  const rxjs = update("rxjs", "5.5.7", "6.6.7");
  stubRegistry({
    "@angular/core": { "5.2.9": { rxjs: "^5.5.0" }, "6.1.10": { rxjs: "^6.0.0" } },
    rxjs: { "5.5.7": {}, "6.6.7": {}, "7.8.2": {} },
  });

  const plan = await planner([
    ["@angular/core", "5.2.9"],
    ["rxjs", "5.5.7"],
  ]).plan([update("@angular/core", "5.2.9", "6.1.10"), update("rxjs", "5.5.7", "7.8.2"), rxjs]);

  // rxjs is part of the Angular group, so it isn't raised again on its own.
  assert.deepEqual(plan.groups.map(versions), [["@angular/core@6.1.10", "rxjs@6.6.7"]]);
  assert.equal(plan.groups[0]![1], rxjs, "members come back as their Renovate rows");
});

test("pulls in an installed package that would break, starting from its peer", async () => {
  stubRegistry({
    "@angular/core": {
      "5.2.9": { rxjs: "^5.5.0" },
      "6.1.10": { rxjs: "^6.0.0" },
      "20.0.0": { rxjs: "^6.5.3 || ^7.4.0" },
    },
    rxjs: { "5.5.7": {}, "7.8.2": {} },
  });

  const plan = await planner([
    ["@angular/core", "5.2.9"],
    ["rxjs", "5.5.7"],
  ]).plan([
    update("rxjs", "5.5.7", "7.8.2"),
    update("@angular/core", "5.2.9", "6.1.10"),
    update("@angular/core", "5.2.9", "20.0.0"),
  ]);

  assert.deepEqual(plan.groups.map(versions), [["rxjs@7.8.2", "@angular/core@20.0.0"]]);
});

// Real data: Renovate offers zone.js as one 0.x stream (0.16.3), but
// @angular/core@20 needs ~0.15.0.
test("skips a group that can't be built from Renovate's versions, with the reason", async () => {
  stubRegistry({
    "@angular/core": { "5.2.9": {}, "20.0.0": { "zone.js": "~0.15.0" } },
    "zone.js": { "0.8.20": {}, "0.16.3": {} },
    chalk: { "5.0.0": {}, "5.3.0": {} },
  });

  const plan = await planner([
    ["@angular/core", "5.2.9"],
    ["zone.js", "0.8.20"],
    ["chalk", "5.0.0"],
  ]).plan([
    update("@angular/core", "5.2.9", "20.0.0"),
    update("zone.js", "0.8.20", "0.16.3"),
    update("chalk", "5.0.0", "5.3.0"),
  ]);

  assert.ok(plan.groups.some((g) => versions(g).includes("chalk@5.3.0")));
  const core = plan.skipped.find((s) => s.dependency === "@angular/core");
  assert.match(core?.reason ?? "", /needs zone\.js ~0\.15\.0; installed is 0\.8\.20/);
});

test("skips only the package whose peers couldn't be checked", async () => {
  stubRegistry({ chalk: { "5.3.0": {} } }, ["rxjs"]);

  const plan = await planner().plan([
    update("rxjs", "5.5.7", "6.6.7"),
    update("chalk", "5.0.0", "5.3.0"),
  ]);

  assert.deepEqual(plan.groups.map(versions), [["chalk@5.3.0"]]);
  assert.deepEqual(plan.skipped, [
    { dependency: "rxjs", reason: 'couldn\'t check peers: npm registry returned 503 for "rxjs"' },
  ]);
});

// --- merging overlapping groups ------------------------------------------------

// Real case from excalidraw-clone: the MUI group is built first (MUI 6 still
// accepts React 18, so React stays out). React 19 then needs MUI at a
// version that accepts it - MUI 6 does, so the two become one group.
test("merges a new package into an earlier group it reaches", async () => {
  stubRegistry({
    "@mui/material": {
      "5.15.3": { react: "^17.0.0 || ^18.0.0" },
      "6.5.0": { react: "^17.0.0 || ^18.0.0 || ^19.0.0" },
    },
    react: { "18.2.0": {}, "19.0.0": {} },
    "react-dom": { "18.2.0": { react: "^18.2.0" }, "19.0.0": { react: "^19.0.0" } },
  });

  const plan = await planner([
    ["@mui/material", "5.15.3"],
    ["react", "18.2.0"],
    ["react-dom", "18.2.0"],
  ]).plan([
    update("@mui/material", "5.15.3", "6.5.0"),
    update("react", "18.2.0", "19.0.0"),
    update("react-dom", "18.2.0", "19.0.0"),
  ]);

  assert.deepEqual(plan.groups.map(versions), [
    ["@mui/material@6.5.0", "react@19.0.0", "react-dom@19.0.0"],
  ]);
  assert.deepEqual(plan.skipped, []);
});

test("merges every earlier group a new package reaches, in place of the first one", async () => {
  stubRegistry({
    a: { "1.0.0": {}, "2.0.0": {} },
    b: { "1.0.0": {}, "2.0.0": {} },
    c: { "1.0.0": {}, "2.0.0": { a: "^2.0.0", b: "^2.0.0" } },
    chalk: { "5.0.0": {}, "5.3.0": {} },
  });

  const plan = await planner([
    ["a", "1.0.0"],
    ["b", "1.0.0"],
    ["c", "1.0.0"],
    ["chalk", "5.0.0"],
  ]).plan([
    update("a", "1.0.0", "2.0.0"),
    update("chalk", "5.0.0", "5.3.0"),
    update("b", "1.0.0", "2.0.0"),
    update("c", "1.0.0", "2.0.0"),
  ]);

  assert.deepEqual(plan.groups.map(versions), [["a@2.0.0", "b@2.0.0", "c@2.0.0"], ["chalk@5.3.0"]]);
});

// The earlier group already chose @angular/core@6.1.10; ngx-toastr@9 needs
// ^7. The merge keeps the earlier choice, so it conflicts - and the earlier
// group stays exactly as it was.
test("keeps the earlier group and skips the new package when merging conflicts", async () => {
  stubRegistry({
    "@angular/core": { "5.2.9": {}, "6.1.10": {}, "7.2.16": {} },
    "ngx-toastr": { "9.0.0": { "@angular/core": "^7.0.0" } },
  });

  const plan = await planner([["@angular/core", "5.2.9"]]).plan([
    update("@angular/core", "5.2.9", "6.1.10"),
    update("@angular/core", "5.2.9", "7.2.16"),
    update("ngx-toastr", "8.0.0", "9.0.0"),
  ]);

  assert.deepEqual(plan.groups.map(versions), [["@angular/core@6.1.10"]]);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0]!.dependency, "ngx-toastr");
  assert.match(plan.skipped[0]!.reason, /group already has @angular\/core@6\.1\.10/);
});
