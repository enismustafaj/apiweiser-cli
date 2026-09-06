import type { CallSite } from "../dependencies/types.ts";

export interface CodemodIdentity {
  datasource: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
}

export interface CodemodPackageManifest extends CodemodIdentity {
  schemaVersion: 1;
  summary: string;
  runtime: "node";
  entrypoint: string;
  testEntrypoint: string;
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

export interface CodemodApplicationInput extends CodemodIdentity {
  repoPath: string;
  packageFile: string;
  callSites: CallSite[];
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

export interface ChangeRequestInput {
  packageName: string;
  version: string;
  newVersion: string;
  callSites: CallSite[];
  isBreaking: boolean;
  summary: string;
}
