import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CodemodIdentity, CodemodPackage } from "./types.ts";

// The registry never reads identity back out of a file the agent wrote (it
// no longer dictates what files a codemod package contains - see
// local-agent.ts) - callers always already have the identity they're
// looking up or storing, so the manifest is synthesized from that rather
// than parsed off disk.
export class CodemodRegistry {
  private readonly rootDirectory: string;

  constructor(rootDirectory = join(homedir(), ".apiweiser-cli", "codemods")) {
    this.rootDirectory = rootDirectory;
  }

  find(identity: CodemodIdentity, summary: string): CodemodPackage | null {
    const id = codemodId(identity);
    const directory = join(this.rootDirectory, id);
    if (!existsSync(directory)) return null;

    return { id, directory, manifest: { ...identity, summary } };
  }

  // sourceDirectory is moved into place atomically (staged, then renamed) so
  // a crash mid-copy never leaves a half-written entry, and so two separate
  // CLI invocations generating the same upgrade concurrently (the registry's
  // real, expected use case - many repos hitting the same breaking update)
  // don't corrupt each other's output.
  store(identity: CodemodIdentity, sourceDirectory: string, summary: string): CodemodPackage {
    const existing = this.find(identity, summary);
    if (existing) return existing;

    const id = codemodId(identity);
    const directory = join(this.rootDirectory, id);
    const stagingDirectory = join(this.rootDirectory, `.${id}-${process.pid}-${Date.now()}`);

    mkdirSync(this.rootDirectory, { recursive: true });
    cpSync(sourceDirectory, stagingDirectory, { recursive: true, errorOnExist: true });

    try {
      renameSync(stagingDirectory, directory);
    } catch (error) {
      rmSync(stagingDirectory, { recursive: true, force: true });
      if (existsSync(directory)) return { id, directory, manifest: { ...identity, summary } };
      throw error;
    }

    return { id, directory, manifest: { ...identity, summary } };
  }
}

export function codemodId(identity: CodemodIdentity): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        identity.datasource,
        identity.packageName,
        identity.fromVersion,
        identity.toVersion,
      ]),
    )
    .digest("hex");
}
