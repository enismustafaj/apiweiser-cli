import { resolve } from "node:path";
import { runProcess } from "./process.ts";
import type { ProcessRunner } from "./process.ts";
import type { CommandResult, VerificationCommand } from "./types.ts";

export class VerificationFailedError extends Error {
  readonly result: CommandResult;

  constructor(result: CommandResult) {
    super(
      `Verification command failed with exit code ${result.exitCode}: ${result.command} ${(result.args ?? []).join(" ")}`,
    );
    this.name = "VerificationFailedError";
    this.result = result;
  }
}

export class RepositoryVerifier {
  private readonly run: ProcessRunner;

  constructor(run: ProcessRunner = runProcess) {
    this.run = run;
  }

  async verify(repoPath: string, commands: VerificationCommand[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];
    for (const command of commands) {
      const result = await this.run(command.command, command.args ?? [], resolve(repoPath));
      results.push(result);
      if (result.exitCode !== 0) throw new VerificationFailedError(result);
    }
    return results;
  }
}
