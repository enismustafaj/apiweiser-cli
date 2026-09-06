import type { CallSite } from "../dependencies/types.ts";

export interface CodemodIdentity {
  datasource: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
}

// Not read from a file the agent wrote - the registry only ever looks this
// up by an identity the caller already has, so it's synthesized from that
// identity rather than parsed out of an agent-authored manifest (see
// registry.ts and generator.ts). `summary` is just the changelog text that
// produced (or reused) this codemod.
export interface CodemodPackageManifest extends CodemodIdentity {
  summary: string;
}

export interface CodemodPackage {
  id: string;
  directory: string;
  manifest: CodemodPackageManifest;
}

export interface CodemodGenerationInput extends CodemodIdentity {
  changelog: string;
  packageFile: string;
  callSites: CallSite[];
}

export interface CodemodAgent {
  generate(input: CodemodGenerationInput, outputDirectory: string): Promise<void>;
}

export interface CodemodApplicationInput {
  repoPath: string;
}

export interface VerificationCommand {
  command: string;
  args?: string[];
}

export interface CommandResult extends VerificationCommand {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ChangeRequestInput extends CodemodGenerationInput {
  repoPath: string;
  verificationCommands?: VerificationCommand[];
}

export interface ChangeRequestResult {
  codemod: CodemodPackage;
  reusedCodemod: boolean;
  application: CommandResult;
  verification: CommandResult[];
}
