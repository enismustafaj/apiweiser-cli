import { statSync } from "node:fs";
import { resolve } from "node:path";
import { runProcess } from "./process.ts";
import type { ProcessRunner } from "./process.ts";
import type { CodemodApplicationInput, CodemodPackage, CommandResult } from "./types.ts";

export class CodemodApplier {
  private readonly run: ProcessRunner;

  constructor(run: ProcessRunner = runProcess) {
    this.run = run;
  }

  async apply(codemod: CodemodPackage, input: CodemodApplicationInput): Promise<CommandResult> {
    const repoPath = resolve(input.repoPath);
    if (!statSync(repoPath, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`Repository directory does not exist: ${repoPath}`);
    }

    const result = await this.run(
      "npx",
      [
        "--yes",
        "codemod",
        "workflow",
        "run",
        "--workflow",
        codemod.directory,
        "--target",
        repoPath,
        "--no-interactive",
        "--allow-fs",
        "--allow-child-process",
      ],
      repoPath,
    );

    if (result.exitCode !== 0) {
      throw new Error(`Codemod failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
    }
    return result;
  }
}
