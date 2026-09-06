import type { ChangeRequestInput } from "./types.ts";

export { CodemodRegistry, codemodId } from "./registry.ts";
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
