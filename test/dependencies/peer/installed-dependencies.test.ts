import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Database } from "../../../src/db/database.ts";
import { PackagesRepository } from "../../../src/dependencies/db/packages-repository.ts";
import { InstalledDependencies } from "../../../src/dependencies/peer/installed-dependencies.ts";
import { RegistryPeers } from "../../../src/dependencies/peer/registry-peers.ts";

const REPO = "/repos/angular";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Registry documents keyed by package name; anything else 404s.
const REGISTRY: Record<string, unknown> = {
  "@angular/core": {
    versions: { "5.2.9": { peerDependencies: { rxjs: "^5.5.0", "zone.js": "^0.8.4" } } },
  },
  "@angular/common": {
    versions: {
      "5.2.9": { peerDependencies: { rxjs: "^5.5.0", "@angular/core": "5.2.9" } },
    },
  },
  rxjs: { versions: { "5.5.7": {} } },
};

function stubRegistry(status?: number): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const name = decodeURIComponent(String(url).replace("https://registry.npmjs.org/", ""));
    requested.push(name);
    const doc = REGISTRY[name];
    return new Response(JSON.stringify(doc ?? {}), { status: status ?? (doc ? 200 : 404) });
  }) as typeof fetch;
  return requested;
}

function installed(direct: [string, string][], transitive: [string, string][] = []) {
  const packages = new PackagesRepository(new Database(":memory:"));
  packages.upsert(REPO, [
    ...direct.map(([name, currentVersion]) => ({ name, currentVersion, type: "direct" as const })),
    ...transitive.map(([name, currentVersion]) => ({
      name,
      currentVersion,
      type: "transitive" as const,
    })),
  ]);
  return new InstalledDependencies(REPO, packages, new RegistryPeers());
}

const ANGULAR: [string, string][] = [
  ["@angular/core", "5.2.9"],
  ["@angular/common", "5.2.9"],
  ["rxjs", "5.5.7"],
];

test("version comes from the database", () => {
  assert.equal(installed(ANGULAR).version("rxjs"), "5.5.7");
  assert.equal(installed(ANGULAR).version("left-pad"), null);
});

test("dependentsOf lists direct dependencies that peer-depend on it, with their ranges", async () => {
  stubRegistry();

  const dependents = await installed(ANGULAR).dependentsOf("rxjs");

  assert.deepEqual(
    dependents.sort((a, b) => a.name.localeCompare(b.name)),
    [
      { name: "@angular/common", version: "5.2.9", range: "^5.5.0" },
      { name: "@angular/core", version: "5.2.9", range: "^5.5.0" },
    ],
  );
});

test("dependentsOf returns an empty list when nothing peer-depends on it", async () => {
  stubRegistry();

  assert.deepEqual(await installed(ANGULAR).dependentsOf("@angular/common"), []);
});

test("dependentsOf only asks the registry about direct dependencies", async () => {
  const requested = stubRegistry();

  await installed(ANGULAR, [["tslib", "1.9.0"]]).dependentsOf("rxjs");

  assert.ok(!requested.includes("tslib"));
});

test("dependentsOf skips a direct dependency the registry doesn't know", async () => {
  stubRegistry();

  const dependents = await installed([...ANGULAR, ["my-workspace-lib", "1.0.0"]]).dependentsOf(
    "rxjs",
  );

  assert.equal(dependents.length, 2);
});

test("dependentsOf throws when the registry fails temporarily", async () => {
  stubRegistry(503);

  await assert.rejects(() => installed(ANGULAR).dependentsOf("rxjs"), /returned 503/);
});
