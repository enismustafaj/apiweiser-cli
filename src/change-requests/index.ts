import type { ChangeRequestInput } from "./types.ts";

export { CodemodRegistry, codemodId } from "./registry.ts";
export type { CodemodIdentity, CodemodPackage, CodemodPackageManifest } from "./types.ts";

export class ChangeRequestsModule {
  create(input: ChangeRequestInput): void {
    throw new Error("not implemented");
  }
}
