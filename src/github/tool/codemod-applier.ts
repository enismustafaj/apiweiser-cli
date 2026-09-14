// Only produces working-tree changes; committing/pushing is GitTool's job.

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
        // The target repo may already have unrelated dirty/untracked files.
        "--allow-dirty",
        "--allow-fs",
      ],
      { cwd: codemodPath, maxBuffer: 1024 * 1024 * 20 },
    );
  }
}
