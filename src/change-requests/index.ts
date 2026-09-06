import { resolve } from "node:path";
import { CodemodApplier } from "./applier.ts";
import { CodexCodemodAgent } from "./codex-agent.ts";
import type { CodexCodemodAgentConfig } from "./codex-agent.ts";
import { CodemodGenerator } from "./generator.ts";
import type { CodemodResolution } from "./generator.ts";
import { repositoryRelativePath } from "./paths.ts";
import { CodemodRegistry } from "./registry.ts";
import type {
  ChangeRequestInput,
  ChangeRequestResult,
  CodemodAgent,
  CodemodApplicationInput,
  CodemodGenerationInput,
  CommandResult,
} from "./types.ts";
import { RepositoryVerifier } from "./verifier.ts";

export { CodemodApplier } from "./applier.ts";
export { CodemodGenerator } from "./generator.ts";
export type { CodemodResolution } from "./generator.ts";
export { CodemodRegistry, codemodId, validateCodemodPackage } from "./registry.ts";
export { RepositoryVerifier, VerificationFailedError } from "./verifier.ts";
export { CodexCodemodAgent } from "./codex-agent.ts";
export type { CodexCodemodAgentConfig } from "./codex-agent.ts";
export type {
  CodemodAgent,
  CodemodApplicationInput,
  CodemodGenerationInput,
  CodemodIdentity,
  CodemodPackage,
  CodemodPackageManifest,
  ChangeRequestInput,
  ChangeRequestResult,
  CommandResult,
  VerificationCommand,
} from "./types.ts";

interface CodemodResolver {
  resolve(input: CodemodGenerationInput): Promise<CodemodResolution>;
}

interface PackageApplier {
  apply(
    codemod: CodemodResolution["codemod"],
    input: CodemodApplicationInput,
  ): Promise<CommandResult>;
}

interface Verifier {
  verify(
    repoPath: string,
    commands: NonNullable<ChangeRequestInput["verificationCommands"]>,
  ): Promise<CommandResult[]>;
}

export interface ChangeRequestsModuleOptions {
  codex?: CodexCodemodAgentConfig;
  agent?: CodemodAgent;
  registry?: CodemodRegistry;
  generator?: CodemodResolver;
  applier?: PackageApplier;
  verifier?: Verifier;
}

export class ChangeRequestsModule {
  private readonly generator: CodemodResolver;
  private readonly applier: PackageApplier;
  private readonly verifier: Verifier;

  constructor(options: ChangeRequestsModuleOptions = {}) {
    const registry = options.registry ?? new CodemodRegistry();
    const agent = options.agent ?? new CodexCodemodAgent(options.codex);
    this.generator = options.generator ?? new CodemodGenerator(agent, registry);
    this.applier = options.applier ?? new CodemodApplier();
    this.verifier = options.verifier ?? new RepositoryVerifier();
  }

  async create(input: ChangeRequestInput): Promise<ChangeRequestResult> {
    const repoPath = resolve(input.repoPath);
    const identity = {
      datasource: input.datasource,
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
    };
    const packageFile = repositoryRelativePath(repoPath, input.packageFile);
    const callSites = input.callSites.map((callSite) => ({
      ...callSite,
      file: repositoryRelativePath(repoPath, callSite.file),
    }));
    const resolution = await this.generator.resolve({
      ...identity,
      packageFile,
      callSites,
      changelog: input.changelog,
    });
    const application = await this.applier.apply(resolution.codemod, {
      ...identity,
      repoPath,
      packageFile,
      callSites,
    });
    const verification = await this.verifier.verify(repoPath, input.verificationCommands ?? []);

    return {
      codemod: resolution.codemod,
      reusedCodemod: resolution.reused,
      application,
      verification,
    };
  }
}
