import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { RegistryPeers } from "../../../src/dependencies/peer/registry-peers.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Real peer data from @angular/core's registry document, trimmed.
const ANGULAR_CORE = {
  versions: {
    "5.2.9": { peerDependencies: { rxjs: "^5.5.0", "zone.js": "^0.8.4" } },
    "20.0.0": {
      peerDependencies: { rxjs: "^6.5.3 || ^7.4.0", "zone.js": "~0.15.0" },
      peerDependenciesMeta: { "zone.js": { optional: true } },
    },
    "1.0.0": {},
  },
};

function stubRegistry(status = 200): { urls: string[]; accepts: (string | null)[] } {
  const calls = { urls: [] as string[], accepts: [] as (string | null)[] };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.urls.push(String(url));
    calls.accepts.push(new Headers(init?.headers).get("Accept"));
    return new Response(JSON.stringify(ANGULAR_CORE), { status });
  }) as typeof fetch;
  return calls;
}

test("peersOf returns a version's peers", async () => {
  stubRegistry();

  const peers = await new RegistryPeers().peersOf("@angular/core", "5.2.9");

  assert.deepEqual(peers, [
    { name: "rxjs", range: "^5.5.0", optional: false },
    { name: "zone.js", range: "^0.8.4", optional: false },
  ]);
});

test("peersOf flags optional peers instead of dropping them", async () => {
  stubRegistry();

  const peers = await new RegistryPeers().peersOf("@angular/core", "20.0.0");

  assert.deepEqual(
    peers.find((p) => p.name === "zone.js"),
    {
      name: "zone.js",
      range: "~0.15.0",
      optional: true,
    },
  );
});

test("peersOf returns an empty list for a version without peers", async () => {
  stubRegistry();

  assert.deepEqual(await new RegistryPeers().peersOf("@angular/core", "1.0.0"), []);
});

test("peersOf requests the abbreviated document with the scoped name encoded", async () => {
  const calls = stubRegistry();

  await new RegistryPeers().peersOf("@angular/core", "5.2.9");

  assert.deepEqual(calls.urls, ["https://registry.npmjs.org/@angular%2Fcore"]);
  assert.deepEqual(calls.accepts, ["application/vnd.npm.install-v1+json"]);
});

test("peersOf fetches each package only once across versions", async () => {
  const calls = stubRegistry();
  const peers = new RegistryPeers();

  await peers.peersOf("@angular/core", "5.2.9");
  await peers.peersOf("@angular/core", "20.0.0");

  assert.equal(calls.urls.length, 1);
});

test("peersOf returns null for a version the registry doesn't list", async () => {
  stubRegistry();

  assert.equal(await new RegistryPeers().peersOf("@angular/core", "99.0.0"), null);
});

// e.g. a workspace, git or file dependency - unknown, not "no peers".
test("peersOf returns null for a package the registry doesn't know", async () => {
  stubRegistry(404);

  assert.equal(await new RegistryPeers().peersOf("my-workspace-lib", "1.0.0"), null);
});

test("peersOf throws on a non-ok response, and retries on the next call", async () => {
  const calls = stubRegistry(503);
  const peers = new RegistryPeers();

  await assert.rejects(() => peers.peersOf("@angular/core", "5.2.9"), /returned 503/);
  await assert.rejects(() => peers.peersOf("@angular/core", "5.2.9"), /returned 503/);

  assert.equal(calls.urls.length, 2);
});
