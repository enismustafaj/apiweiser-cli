import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { SbomTool } from "../../../src/dependencies/sbom/sbom-tool.ts";

// Reads this repo's own real node_modules - fast, local, no network.
test("generate reports this repo's own direct dependencies", async () => {
  const dependencies = await new SbomTool().generate(".");

  const commander = dependencies.find((dependency) => dependency.name === "commander");
  assert.ok(commander, "expected commander in this repo's own dependencies");
  assert.equal(commander?.type, "direct");
});

// typescript is a real devDependency of this repo itself, so no fixture needed.
test("generate flags a devDependency via isDevDependency", async () => {
  const dependencies = await new SbomTool().generate(".");

  const commander = dependencies.find((dependency) => dependency.name === "commander");
  const typescript = dependencies.find((dependency) => dependency.name === "typescript");
  assert.equal(commander?.isDevDependency, false);
  assert.equal(typescript?.isDevDependency, true);
});

function writePackage(dir: string, manifest: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
}

function summarize(dependencies: Awaited<ReturnType<SbomTool["generate"]>>) {
  return dependencies
    .map((d) => [d.name, d.currentVersion, d.type, d.isDevDependency ? "dev" : "runtime"])
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

// The shape a yarn `resolutions` install leaves: ps-tree wants
// event-stream =3.3.4 but 4.0.1 is installed. `npm sbom` refused this tree.
test("reads a hoisted tree npm would call invalid, one entry per name", async () => {
  const repo = mkdtempSync(join(tmpdir(), "apiweiser-hoisted-"));
  writePackage(repo, {
    name: "app",
    dependencies: { chalk: "^2.4.1", "ps-tree": "^1.2.0" },
    devDependencies: { jest: "^26.0.0" },
  });
  const nm = join(repo, "node_modules");
  writePackage(join(nm, "chalk"), { name: "chalk", version: "2.4.1" });
  writePackage(join(nm, "ps-tree"), {
    name: "ps-tree",
    version: "1.2.0",
    dependencies: { "event-stream": "=3.3.4" },
  });
  writePackage(join(nm, "event-stream"), { name: "event-stream", version: "4.0.1" });
  writePackage(join(nm, "jest"), {
    name: "jest",
    version: "26.6.3",
    dependencies: { chalk: "^4" },
  });
  // jest's own, newer chalk - nested, so the repo's direct chalk keeps 2.4.1
  writePackage(join(nm, "jest", "node_modules", "chalk"), { name: "chalk", version: "4.1.2" });
  writePackage(join(nm, "@scope", "util"), { name: "@scope/util", version: "1.0.0" });
  mkdirSync(join(nm, ".bin"));

  assert.deepEqual(summarize(await new SbomTool().generate(repo)), [
    ["@scope/util", "1.0.0", "transitive", "dev"],
    ["chalk", "2.4.1", "direct", "runtime"],
    ["event-stream", "4.0.1", "transitive", "runtime"],
    ["jest", "26.6.3", "direct", "dev"],
    ["ps-tree", "1.2.0", "direct", "runtime"],
  ]);
});

// pnpm: node_modules/<direct> symlinks into node_modules/.pnpm/<id>/node_modules,
// where each package's own dependencies are symlinked next to it.
test("reads a pnpm tree through its symlinks and store", async () => {
  const repo = mkdtempSync(join(tmpdir(), "apiweiser-pnpm-"));
  writePackage(repo, { name: "app", dependencies: { express: "^4" } });
  const store = join(repo, "node_modules", ".pnpm");
  const express = join(store, "express@4.21.0", "node_modules", "express");
  const debug = join(store, "debug@2.6.9", "node_modules", "debug");
  writePackage(express, { name: "express", version: "4.21.0", dependencies: { debug: "2.6.9" } });
  writePackage(debug, { name: "debug", version: "2.6.9" });
  symlinkSync(express, join(repo, "node_modules", "express"));
  symlinkSync(debug, join(dirname(express), "debug"));

  assert.deepEqual(summarize(await new SbomTool().generate(repo)), [
    ["debug", "2.6.9", "transitive", "runtime"],
    ["express", "4.21.0", "direct", "runtime"],
  ]);
});

test("generate fails clearly when nothing is installed", async () => {
  const repo = mkdtempSync(join(tmpdir(), "apiweiser-empty-"));
  writePackage(repo, { name: "app" });

  await assert.rejects(new SbomTool().generate(repo), /has no node_modules/);
});
