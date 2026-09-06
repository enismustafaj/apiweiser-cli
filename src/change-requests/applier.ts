import { statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
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
    assertIdentity(codemod, input);

    const request = {
      ...input,
      repoPath,
      packageFile: repositoryRelativePath(repoPath, input.packageFile),
      callSites: input.callSites.map((callSite) => ({
        ...callSite,
        file: repositoryRelativePath(repoPath, callSite.file),
      })),
    };
    const entrypoint = join(codemod.directory, codemod.manifest.entrypoint);
    const result = await this.run(
      process.execPath,
      [entrypoint],
      repoPath,
      JSON.stringify(request),
    );

    if (result.exitCode !== 0) {
      throw new Error(`Codemod failed with exit code ${result.exitCode}: ${result.stderr.trim()}`);
    }
    return result;
  }
}

function repositoryRelativePath(repoPath: string, path: string): string {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(repoPath, path);
  const relativePath = relative(repoPath, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Path is outside repository: ${path}`);
  }
  return relativePath;
}

function assertIdentity(codemod: CodemodPackage, input: CodemodApplicationInput): void {
  const manifest = codemod.manifest;
  if (
    manifest.datasource !== input.datasource ||
    manifest.packageName !== input.packageName ||
    manifest.fromVersion !== input.fromVersion ||
    manifest.toVersion !== input.toVersion
  ) {
    throw new Error("Codemod package does not match the requested upgrade");
  }
}
