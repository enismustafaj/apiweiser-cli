import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CodemodRegistry } from "../../../src/change-requests/registry/codemod-registry.ts";

const BASE = join("/", "registry");

function registry(): CodemodRegistry {
  return new CodemodRegistry(BASE);
}

test("dirFor keys a directory by package name and major-version pair", () => {
  assert.equal(
    registry().dirFor("commander", "15.0.0", "16.0.0"),
    join(BASE, "commander", "15_to_16"),
  );
});

test("dirFor sanitizes path separators in the package name", () => {
  assert.equal(
    registry().dirFor("@scope/pkg", "1.0.0", "2.0.0"),
    join(BASE, "@scope_pkg", "1_to_2"),
  );
});

// The actual point of keying by major version: real repos rarely pin the
// exact same patch version, but the migration (and its codemod) is the
// same regardless.
test("dirFor resolves the same directory for different patch/minor versions within the same majors", () => {
  const reg = registry();

  assert.equal(reg.dirFor("chalk", "4.1.0", "5.0.0"), reg.dirFor("chalk", "4.1.2", "5.2.7"));
});

test("dirFor resolves to a different directory for a different major-version pair", () => {
  const reg = registry();

  assert.notEqual(reg.dirFor("chalk", "4.1.0", "5.0.0"), reg.dirFor("chalk", "5.0.0", "6.0.0"));
});

// Two different same-major "breaking" releases could be entirely unrelated
// fixes - coarsening them together would point the agent at a codemod that
// has nothing to do with the current one, so these keep the exact pair.
test("dirFor keeps the exact version pair for a same-major upgrade", () => {
  assert.equal(
    registry().dirFor("some-pkg", "2.4.5", "2.7.0"),
    join(BASE, "some-pkg", "2.4.5_to_2.7.0"),
  );
});

test("dirFor resolves different directories for two different same-major upgrades", () => {
  const reg = registry();

  assert.notEqual(
    reg.dirFor("some-pkg", "2.4.5", "2.7.0"),
    reg.dirFor("some-pkg", "2.8.0", "2.9.0"),
  );
});

// The agent creates the directory when it writes a codemod; `codemod` only
// looks, so a never-used key must stay absent.
test("dirFor doesn't create the directory", () => {
  assert.equal(existsSync(registry().dirFor("never-scanned", "1.0.0", "2.0.0")), false);
});

// remoteName mirrors dirFor's own major-crossing-vs-exact-version rule
// (a local entry and its published counterpart must agree on this), just
// as a flat, dash-joined string instead of a directory path.
test("remoteName mirrors dirFor's major-only keying for a major-crossing upgrade", () => {
  const name = registry().remoteName("chalk", "4.1.2", "5.2.7");

  assert.equal(name, "chalk-4-to-5");
});

test("remoteName mirrors dirFor's exact-version keying for a same-major upgrade", () => {
  const name = registry().remoteName("some-pkg", "2.4.5", "2.7.0");

  assert.equal(name, "some-pkg-2.4.5-to-2.7.0");
});

test("remoteName strips both path separators and the leading @ from a scoped package name", () => {
  const name = registry().remoteName("@scope/pkg", "1.0.0", "2.0.0");

  assert.equal(name, "scope_pkg-1-to-2");
});
