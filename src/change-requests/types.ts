import type { CallSite } from "../dependencies/types.ts";

export interface CodemodIdentity {
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

export interface ChangeRequestInput {
  packageName: string;
  version: string;
  newVersion: string;
  callSites: CallSite[];
  isBreaking: boolean;
  summary: string;
}
