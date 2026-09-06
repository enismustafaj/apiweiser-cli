import { resolve } from "node:path";
import { CodemodApplier } from "./applier.ts";
import { CodemodGenerator } from "./generator.ts";
import type { CodemodResolution } from "./generator.ts";
import { repositoryRelativeCallSites, repositoryRelativePath } from "./paths.ts";
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
export { CodemodRegistry, codemodId } from "./registry.ts";
export { RepositoryVerifier, VerificationFailedError } from "./verifier.ts";
export { LocalCodemodAgent } from "./local-agent.ts";
export type { LocalCodemodAgentConfig } from "./local-agent.ts";
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
    this.generator =
      options.generator ??
      new CodemodGenerator(requireAgent(options.agent), options.registry ?? new CodemodRegistry());
    this.applier = options.applier ?? new CodemodApplier();
    this.verifier = options.verifier ?? new RepositoryVerifier();
  }

  async create(input: ChangeRequestInput): Promise<ChangeRequestResult> {
    const repoPath = resolve(input.repoPath);
    // Deliberately narrower than `input`: repoPath and verificationCommands
    // must not reach the generation step, since that ends up in the prompt
    // sent to an external coding agent (see local-agent.ts) - only the
    // upgrade's identity, changelog, and call sites belong there.
    const resolution = await this.generator.resolve({
      datasource: input.datasource,
      packageName: input.packageName,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      changelog: input.changelog,
      packageFile: repositoryRelativePath(repoPath, input.packageFile),
      callSites: repositoryRelativeCallSites(repoPath, input.callSites),
    });
    const application = await this.applier.apply(resolution.codemod, { repoPath });
    const verification = await this.verifier.verify(repoPath, input.verificationCommands ?? []);

    return {
      codemod: resolution.codemod,
      reusedCodemod: resolution.reused,
      application,
      verification,
    };
  }
}

function requireAgent(agent: CodemodAgent | undefined): CodemodAgent {
  if (!agent) {
    throw new Error(
      "ChangeRequestsModule needs a codemod agent - pass options.agent, e.g. " +
        "new LocalCodemodAgent({ command: <your coding agent CLI> }).",
    );
  }
  return agent;
}
