import assert from "node:assert/strict";
import { test } from "node:test";
import type { InstalledDependencies } from "../../../src/dependencies/peer/installed-dependencies.ts";
import { PeerGrouper } from "../../../src/dependencies/peer/peer-grouper.ts";
import type { RegistryPeers } from "../../../src/dependencies/peer/registry-peers.ts";
import type { InstalledDependent, PeerRequirement } from "../../../src/dependencies/peer/types.ts";

interface Scenario {
  // "name@version" -> its peers; a version not listed has none, null means
  // the registry doesn't know it.
  peers?: Record<string, PeerRequirement[] | null>;
  installed?: Record<string, string>;
  dependents?: Record<string, InstalledDependent[]>;
}

function grouper({ peers = {}, installed = {}, dependents = {} }: Scenario): PeerGrouper {
  const registry = {
    peersOf: async (name: string, version: string) => {
      const key = `${name}@${version}`;
      return key in peers ? peers[key]! : [];
    },
  };
  const installedDependencies = {
    version: (name: string) => installed[name] ?? null,
    dependentsOf: async (name: string) => dependents[name] ?? [],
  };
  return new PeerGrouper(
    registry as unknown as RegistryPeers,
    installedDependencies as unknown as InstalledDependencies,
  );
}

function peer(name: string, range: string, optional = false): PeerRequirement {
  return { name, range, optional };
}

function candidates(entries: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(entries));
}

// --- forward: what a member's new version needs ---------------------------

test("a seed without peers is a group of one", async () => {
  const group = await grouper({}).build([{ name: "chalk", version: "5.0.0" }], candidates({}));

  assert.deepEqual(group, { conflict: false, members: [{ name: "chalk", version: "5.0.0" }] });
});

test("pulls in a peer at its lowest Renovate candidate that fits", async () => {
  const group = await grouper({
    peers: { "@angular/core@6.1.10": [peer("rxjs", "^6.0.0")] },
    installed: { rxjs: "5.5.7" },
  }).build(
    [{ name: "@angular/core", version: "6.1.10" }],
    candidates({ rxjs: ["7.8.2", "5.5.12", "6.6.7"] }),
  );

  assert.deepEqual(group, {
    conflict: false,
    members: [
      { name: "@angular/core", version: "6.1.10" },
      { name: "rxjs", version: "6.6.7" },
    ],
  });
});

test("leaves out a peer whose installed version already fits", async () => {
  const group = await grouper({
    peers: { "@angular/core@6.1.10": [peer("rxjs", "^6.0.0")] },
    installed: { rxjs: "6.2.0" },
  }).build([{ name: "@angular/core", version: "6.1.10" }], candidates({ rxjs: ["6.6.7"] }));

  assert.equal(group.members.length, 1);
});

// npm 7+ and pnpm install a missing peer themselves.
test("leaves out a peer that isn't installed at all", async () => {
  const group = await grouper({
    peers: {
      "@angular/core@20.0.0": [peer("rxjs", "^7.4.0"), peer("zone.js", "~0.15.0", true)],
    },
  }).build([{ name: "@angular/core", version: "20.0.0" }], candidates({ rxjs: ["7.8.2"] }));

  assert.equal(group.members.length, 1);
});

// Real data: Renovate offers zone.js only as one 0.x stream (0.16.3), but
// @angular/core@20 needs ~0.15.0 - and an installed optional peer still counts.
test("is a conflict when an installed optional peer has no fitting candidate", async () => {
  const group = await grouper({
    peers: { "@angular/core@20.0.0": [peer("zone.js", "~0.15.0", true)] },
    installed: { "zone.js": "0.8.20" },
  }).build([{ name: "@angular/core", version: "20.0.0" }], candidates({ "zone.js": ["0.16.3"] }));

  assert.equal(group.conflict, true);
  assert.deepEqual(group.members, [{ name: "@angular/core", version: "20.0.0" }]);
  assert.match(
    group.conflict ? group.reason : "",
    /@angular\/core@20\.0\.0 needs zone\.js ~0\.15\.0; installed is 0\.8\.20, Renovate offers \[0\.16\.3\]/,
  );
});

test("checks the peers of packages it pulled in, too", async () => {
  const group = await grouper({
    peers: {
      "@angular/core@6.1.10": [peer("rxjs", "^6.0.0")],
      "rxjs@6.6.7": [peer("tslib", "^1.9.0")],
    },
    installed: { rxjs: "5.5.7", tslib: "1.0.0" },
  }).build(
    [{ name: "@angular/core", version: "6.1.10" }],
    candidates({ rxjs: ["6.6.7"], tslib: ["1.9.3"] }),
  );

  assert.deepEqual(
    group.members.map((m) => `${m.name}@${m.version}`),
    ["@angular/core@6.1.10", "rxjs@6.6.7", "tslib@1.9.3"],
  );
});

test("is a conflict when a member needs a version the group already moved past", async () => {
  const group = await grouper({
    peers: {
      "a@2.0.0": [peer("b", "^2.0.0"), peer("c", "^1.0.0")],
      "c@1.0.0": [peer("b", "^1.0.0")],
    },
    installed: { b: "1.0.0", c: "0.5.0" },
  }).build([{ name: "a", version: "2.0.0" }], candidates({ b: ["2.0.0"], c: ["1.0.0"] }));

  assert.equal(group.conflict, true);
  assert.match(group.conflict ? group.reason : "", /group already has b@2\.0\.0/);
});

test("is a conflict when the registry doesn't know a member's version", async () => {
  const group = await grouper({ peers: { "my-lib@1.0.0": null } }).build(
    [{ name: "my-lib", version: "1.0.0" }],
    candidates({}),
  );

  assert.equal(group.conflict, true);
});

// --- reverse: what installed packages break when a member moves -----------

test("pulls in an installed dependent at its lowest candidate that accepts the new version", async () => {
  const group = await grouper({
    peers: {
      "@angular/core@6.1.10": [peer("rxjs", "^6.0.0")],
      "@angular/core@20.0.0": [peer("rxjs", "^6.5.3 || ^7.4.0")],
    },
    dependents: { rxjs: [{ name: "@angular/core", version: "5.2.9", range: "^5.5.0" }] },
  }).build(
    [{ name: "rxjs", version: "7.8.2" }],
    candidates({ "@angular/core": ["20.0.0", "6.1.10"] }),
  );

  assert.deepEqual(group, {
    conflict: false,
    members: [
      { name: "rxjs", version: "7.8.2" },
      { name: "@angular/core", version: "20.0.0" },
    ],
  });
});

test("leaves out a dependent whose range already accepts the new version", async () => {
  const group = await grouper({
    dependents: { rxjs: [{ name: "@angular/core", version: "6.1.10", range: "^6.0.0" }] },
  }).build([{ name: "rxjs", version: "6.6.7" }], candidates({}));

  assert.equal(group.members.length, 1);
});

test("accepts a dependent version that no longer lists the package as a peer", async () => {
  const group = await grouper({
    peers: { "old-plugin@2.0.0": [] },
    dependents: { rxjs: [{ name: "old-plugin", version: "1.0.0", range: "^5.0.0" }] },
  }).build([{ name: "rxjs", version: "7.8.2" }], candidates({ "old-plugin": ["2.0.0"] }));

  assert.deepEqual(
    group.members.map((m) => m.name),
    ["rxjs", "old-plugin"],
  );
});

test("is a conflict when no candidate of a dependent accepts the new version", async () => {
  const group = await grouper({
    peers: { "@angular/core@6.1.10": [peer("rxjs", "^6.0.0")] },
    dependents: { rxjs: [{ name: "@angular/core", version: "5.2.9", range: "^5.5.0" }] },
  }).build([{ name: "rxjs", version: "7.8.2" }], candidates({ "@angular/core": ["6.1.10"] }));

  assert.equal(group.conflict, true);
  assert.match(group.conflict ? group.reason : "", /none of Renovate's @angular\/core versions/);
});

test("is a conflict when a dependent has no candidates at all", async () => {
  const group = await grouper({
    dependents: { rxjs: [{ name: "@angular/core", version: "5.2.9", range: "^5.5.0" }] },
  }).build([{ name: "rxjs", version: "7.8.2" }], candidates({}));

  assert.equal(group.conflict, true);
});

// The dependent is already moving to a new version, so its *new* range is
// what matters, not the installed one dependentsOf reports.
test("checks a dependent that's already in the group against its new version", async () => {
  const group = await grouper({
    peers: { "@angular/core@20.0.0": [peer("rxjs", "^7.4.0")] },
    installed: { rxjs: "5.5.7" },
    dependents: { rxjs: [{ name: "@angular/core", version: "5.2.9", range: "^5.5.0" }] },
  }).build([{ name: "@angular/core", version: "20.0.0" }], candidates({ rxjs: ["7.8.2"] }));

  assert.deepEqual(group, {
    conflict: false,
    members: [
      { name: "@angular/core", version: "20.0.0" },
      { name: "rxjs", version: "7.8.2" },
    ],
  });
});

// --- several seeds -----------------------------------------------------------

test("starts the group with every seed and pulls in what each one needs", async () => {
  const group = await grouper({
    peers: { "a@2.0.0": [peer("x", "^2.0.0")], "b@2.0.0": [peer("y", "^3.0.0")] },
    installed: { x: "1.0.0", y: "2.0.0" },
  }).build(
    [
      { name: "a", version: "2.0.0" },
      { name: "b", version: "2.0.0" },
    ],
    candidates({ x: ["2.0.0"], y: ["3.0.0"] }),
  );

  assert.deepEqual(
    group.members.map((m) => `${m.name}@${m.version}`),
    ["a@2.0.0", "b@2.0.0", "x@2.0.0", "y@3.0.0"],
  );
});

test("keeps a seed at the version it was given, even if a lower one would fit", async () => {
  const group = await grouper({
    peers: { "a@2.0.0": [peer("x", "^2.0.0")] },
    installed: { x: "1.0.0" },
  }).build(
    [
      { name: "a", version: "2.0.0" },
      { name: "x", version: "2.5.0" },
    ],
    candidates({ x: ["2.0.0", "2.5.0"] }),
  );

  assert.deepEqual(group.members, [
    { name: "a", version: "2.0.0" },
    { name: "x", version: "2.5.0" },
  ]);
});

test("is a conflict when the seeds don't fit together", async () => {
  const group = await grouper({
    peers: { "a@2.0.0": [peer("x", "^2.0.0")] },
    installed: { x: "1.0.0" },
  }).build(
    [
      { name: "a", version: "2.0.0" },
      { name: "x", version: "1.5.0" },
    ],
    candidates({ x: ["1.5.0", "2.0.0"] }),
  );

  assert.equal(group.conflict, true);
  assert.match(group.conflict ? group.reason : "", /group already has x@1\.5\.0/);
});

// The real case behind merging: an existing MUI 6 group plus react@19.
// MUI 6 already accepts React 19, so only react-dom has to join.
test("extends an existing group with a new seed it accepts", async () => {
  const group = await grouper({
    peers: {
      "@mui/material@6.5.0": [peer("react", "^17.0.0 || ^18.0.0 || ^19.0.0")],
      "react-dom@19.0.0": [peer("react", "^19.0.0")],
    },
    dependents: {
      react: [
        { name: "@mui/material", version: "5.15.3", range: "^17.0.0 || ^18.0.0" },
        { name: "react-dom", version: "18.2.0", range: "^18.2.0" },
      ],
    },
    installed: { react: "18.2.0" },
  }).build(
    [
      { name: "@mui/material", version: "6.5.0" },
      { name: "react", version: "19.0.0" },
    ],
    candidates({ "react-dom": ["19.0.0"] }),
  );

  assert.deepEqual(group, {
    conflict: false,
    members: [
      { name: "@mui/material", version: "6.5.0" },
      { name: "react", version: "19.0.0" },
      { name: "react-dom", version: "19.0.0" },
    ],
  });
});

// --- errors ----------------------------------------------------------------

test("lets real errors through instead of reporting them as conflicts", async () => {
  const failing = {
    peersOf: async () => {
      throw new Error("npm registry returned 503");
    },
  };
  const grouperWithFailingRegistry = new PeerGrouper(
    failing as unknown as RegistryPeers,
    { version: () => null, dependentsOf: async () => [] } as unknown as InstalledDependencies,
  );

  await assert.rejects(
    () => grouperWithFailingRegistry.build([{ name: "rxjs", version: "7.8.2" }], candidates({})),
    /returned 503/,
  );
});
