import { spawn } from "node:child_process";
import type { CommandResult } from "./types.ts";

export type ProcessRunner = (
  command: string,
  args: string[],
  cwd: string,
  stdin?: string,
) => Promise<CommandResult>;

export const runProcess: ProcessRunner = (command, args, cwd, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ command, args, exitCode: exitCode ?? 1, stdout, stderr });
    });

    child.stdin.end(stdin);
  });
