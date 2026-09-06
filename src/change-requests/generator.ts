import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CodemodRegistry, validateCodemodPackage } from "./registry.ts";
import type { CodemodAgent, CodemodGenerationInput, CodemodPackage } from "./types.ts";

const execFileAsync = promisify(execFile);

export interface CodemodResolution {
  codemod: CodemodPackage;
  reused: boolean;
}

type PackageTestRunner = (directory: string, testEntrypoint: string) => Promise<void>;

export class CodemodGenerator {
  private readonly agent: CodemodAgent;
  private readonly registry: CodemodRegistry;
  private readonly runPackageTest: PackageTestRunner;

  constructor(
    agent: CodemodAgent,
    registry: CodemodRegistry,
    runPackageTest: PackageTestRunner = defaultPackageTestRunner,
  ) {
    this.agent = agent;
    this.registry = registry;
    this.runPackageTest = runPackageTest;
  }

  async resolve(input: CodemodGenerationInput): Promise<CodemodResolution> {
    const existing = this.registry.find(input);
    if (existing) return { codemod: existing, reused: true };

    const outputDirectory = mkdtempSync(join(tmpdir(), "apiweiser-codemod-"));
    try {
      await this.agent.generate(input, outputDirectory);
      const manifest = validateCodemodPackage(outputDirectory, input);
      await this.runPackageTest(outputDirectory, manifest.testEntrypoint);
      return { codemod: this.registry.store(outputDirectory), reused: false };
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}

async function defaultPackageTestRunner(directory: string, testEntrypoint: string): Promise<void> {
  await execFileAsync(process.execPath, ["--test", join(directory, testEntrypoint)], {
    cwd: directory,
  });
}
