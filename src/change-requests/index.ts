import type { ChangeRequestInput } from "./types.ts";

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
  CommandResult,
  VerificationCommand,
} from "./types.ts";

export class ChangeRequestsModule {
  create(input: ChangeRequestInput): void {
    throw new Error("not implemented");
  }
}
