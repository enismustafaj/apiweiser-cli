import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { CodemodRegistry } from "../../../src/change-requests/registry/codemod-registry.ts";

const createdDirs: string[] = [];

function registry(): CodemodRegistry {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-codemod-registry-test-"));
  createdDirs.push(dir);
  return new CodemodRegistry(dir);
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

test("pathFor creates and returns a directory keyed by package name and major-version pair", () => {
  const path = registry().pathFor("commander", "15.0.0", "16.0.0");

  assert.ok(existsSync(path));
  assert.match(path, /commander[/\\]15_to_16$/);
});

test("pathFor sanitizes path separators in the package name", () => {
  const path = registry().pathFor("@scope/pkg", "1.0.0", "2.0.0");

  assert.ok(existsSync(path));
  assert.match(path, /@scope_pkg/);
});

test("pathFor returns the same directory on repeat calls, without clearing it", () => {
  const reg = registry();
  const first = reg.pathFor("commander", "15.0.0", "16.0.0");

  const second = reg.pathFor("commander", "15.0.0", "16.0.0");

  assert.equal(first, second);
});

// The actual point of keying by major version: real repos rarely pin the
// exact same patch version, but the migration (and its codemod) is the
// same regardless - see CodemodRegistry's comment for the measured payoff.
test("pathFor resolves the same directory for different patch/minor versions within the same majors", () => {
  const reg = registry();
  const first = reg.pathFor("chalk", "4.1.0", "5.0.0");

  const second = reg.pathFor("chalk", "4.1.2", "5.2.7");

  assert.equal(first, second);
});

test("pathFor resolves to a different directory for a different major-version pair", () => {
  const reg = registry();
  const v4to5 = reg.pathFor("chalk", "4.1.0", "5.0.0");

  const v5to6 = reg.pathFor("chalk", "5.0.0", "6.0.0");

  assert.notEqual(v4to5, v5to6);
});

// A same-major "breaking" release (this classification comes from an LLM
// reading changelog prose, not semver convention - a package can ship a
// breaking change without a major bump) has no equivalent stable "recipe"
// to generalize across - two different 2.x "breaking" releases could be
// entirely unrelated fixes. Coarsening those together would point the
// agent at a prior entry that has nothing to do with the current one, not
// just an incomplete one - so this stays keyed by the full, exact version
// pair instead of major-only.
test("pathFor keeps the exact version pair for a same-major upgrade", () => {
  const path = registry().pathFor("some-pkg", "2.4.5", "2.7.0");

  assert.match(path, /some-pkg[/\\]2\.4\.5_to_2\.7\.0$/);
});

test("pathFor resolves different directories for two different same-major upgrades", () => {
  const reg = registry();
  const first = reg.pathFor("some-pkg", "2.4.5", "2.7.0");

  const second = reg.pathFor("some-pkg", "2.8.0", "2.9.0");

  assert.notEqual(first, second);
});
