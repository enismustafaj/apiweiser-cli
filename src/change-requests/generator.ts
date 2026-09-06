import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CodemodRegistry } from "./registry.ts";
import type {
  CodemodAgent,
  CodemodGenerationInput,
  CodemodIdentity,
  CodemodPackage,
} from "./types.ts";

const execFileAsync = promisify(execFile);

export interface CodemodResolution {
  codemod: CodemodPackage;
  reused: boolean;
}

type PackageValidator = (directory: string) => Promise<void>;
type PackageTestRunner = (directory: string) => Promise<void>;

export class CodemodGenerator {
  private readonly agent: CodemodAgent;
  private readonly registry: CodemodRegistry;
  private readonly validatePackage: PackageValidator;
  private readonly runPackageTest: PackageTestRunner;

  constructor(
    agent: CodemodAgent,
    registry: CodemodRegistry,
    validatePackage: PackageValidator = defaultPackageValidator,
    runPackageTest: PackageTestRunner = defaultPackageTestRunner,
  ) {
    this.agent = agent;
    this.registry = registry;
    this.validatePackage = validatePackage;
    this.runPackageTest = runPackageTest;
  }

  async resolve(input: CodemodGenerationInput): Promise<CodemodResolution> {
    // Narrowed explicitly: `find`/`store` spread this into the stored
    // manifest, and input carries extra fields (changelog, packageFile,
    // callSites) that would otherwise leak into it - TypeScript's structural
    // typing lets `input` pass where CodemodIdentity is expected, but the
    // spread at runtime doesn't know to stop at those four fields.
    const identity: CodemodIdentity = {
      datasource: input.datasource,
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
    };
    const existing = this.registry.find(identity, input.changelog);
    if (existing) return { codemod: existing, reused: true };

    const outputDirectory = mkdtempSync(join(tmpdir(), "apiweiser-codemod-"));
    try {
      await this.agent.generate(input, outputDirectory);
      await this.validatePackage(outputDirectory);
      await this.runPackageTest(outputDirectory);
      return {
        codemod: this.registry.store(identity, outputDirectory, input.changelog),
        reused: false,
      };
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}

// Delegates "is this actually a working codemod, not just a starter
// scaffold" to Codemod AI's own checker instead of validating our own file
// format - we no longer dictate what files a codemod package contains.
async function defaultPackageValidator(directory: string): Promise<void> {
  const { stdout } = await execFileAsync("npx", [
    "--yes",
    "codemod",
    "ai",
    "call",
    "validate_codemod_package",
    "--input",
    JSON.stringify({ package_path: directory }),
  ]);
  const report = JSON.parse(stdout) as { ready: boolean; issues?: { message: string }[] };
  if (!report.ready) {
    const issues = (report.issues ?? []).map((issue) => issue.message).join("; ");
    throw new Error(
      `Generated codemod package is not ready: ${issues || "unknown validation failure"}`,
    );
  }
}

async function defaultPackageTestRunner(directory: string): Promise<void> {
  await execFileAsync("npm", ["test"], { cwd: directory });
}
