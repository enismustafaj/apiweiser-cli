import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { DependencyBumper } from "../../../src/github/tool/dependency-bumper.ts";

const createdDirs: string[] = [];

function repoWithPackageJson(pkg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "apiweiser-cli-dependency-bumper-test-"));
  createdDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

// bump() shells out to a real package manager once a package is confirmed
// declared - not covered by an automated test here (network-bound, same
// reasoning as RenovateTool, see docs/suggestions.md). This only exercises
// the guard that decides whether to run an install at all, which is pure
// and doesn't touch the network.
test("bump is a no-op when the package isn't a direct dependency", async () => {
  const dir = repoWithPackageJson({ dependencies: { commander: "^15.0.0" } });

  // Would throw (ENOENT/network) if it tried to actually run an install -
  // resolving cleanly confirms it returned early instead.
  await new DependencyBumper().bump(dir, "chalk", "5.0.0");
});

test("bump is a no-op for a package only listed as a peerDependency", async () => {
  const dir = repoWithPackageJson({ peerDependencies: { chalk: "^4.0.0" } });

  await new DependencyBumper().bump(dir, "chalk", "5.0.0");
});
