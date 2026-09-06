import type { ChangeRequestInput } from "./types.ts";

export { CodemodGenerator } from "./generator.ts";
export type { CodemodResolution } from "./generator.ts";
export { CodemodRegistry, codemodId, validateCodemodPackage } from "./registry.ts";
export { CodexCodemodAgent } from "./codex-agent.ts";
export type { CodexCodemodAgentConfig } from "./codex-agent.ts";
export type {
  CodemodAgent,
  CodemodGenerationInput,
  CodemodIdentity,
  CodemodPackage,
  CodemodPackageManifest,
} from "./types.ts";

export class ChangeRequestsModule {
  create(input: ChangeRequestInput): void {
    throw new Error("not implemented");
  }
}
