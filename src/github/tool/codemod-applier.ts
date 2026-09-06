// Applies an already-built, already-tested codemod package's workflow to a
// real target repo, via the codemod CLI's own workflow runner - the same
// tool used to build/test the package itself (see docs/change-requests.md).
// This only ever produces working-tree changes; committing/pushing them is
// GitTool's job.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class CodemodApplier {
  async apply(codemodPath: string, targetRepoPath: string): Promise<void> {
    await execFileAsync(
      "npx",
      [
        "--yes",
        "codemod",
        "workflow",
        "run",
        "-w",
        join(codemodPath, "workflow.yaml"),
        "-t",
        targetRepoPath,
        "--no-interactive",
        // The target repo may have pre-existing untracked/dirty files
        // unrelated to this migration (build output, local config, ...) -
        // this only cares about what the codemod itself changes, not
        // whether the repo was already clean.
        "--allow-dirty",
        "--allow-fs",
      ],
      { cwd: codemodPath, maxBuffer: 1024 * 1024 * 20 },
    );
  }
}
