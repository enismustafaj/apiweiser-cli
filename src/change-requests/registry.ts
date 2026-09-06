import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import type { CodemodIdentity, CodemodPackage, CodemodPackageManifest } from "./types.ts";

const MANIFEST_FILE = "codemod.json";

export class CodemodRegistry {
  private readonly rootDirectory: string;

  constructor(rootDirectory = join(homedir(), ".apiweiser-cli", "codemods")) {
    this.rootDirectory = rootDirectory;
  }

  find(identity: CodemodIdentity): CodemodPackage | null {
    const id = codemodId(identity);
    const directory = join(this.rootDirectory, id);
    if (!existsSync(directory)) return null;

    return this.load(directory, id, identity);
  }

  store(sourceDirectory: string): CodemodPackage {
    const manifest = readManifest(sourceDirectory);
    validatePackageFiles(sourceDirectory, manifest);

    const identity = identityFrom(manifest);
    const existing = this.find(identity);
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
      if (existsSync(directory)) return this.load(directory, id, identity);
      throw error;
    }

    return { id, directory, manifest };
  }

  private load(directory: string, id: string, expectedIdentity: CodemodIdentity): CodemodPackage {
    const manifest = readManifest(directory);
    validateIdentity(manifest, expectedIdentity);
    validatePackageFiles(directory, manifest);
    return { id, directory, manifest };
  }
}

export function codemodId(identity: CodemodIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.packageName, identity.fromVersion, identity.toVersion]))
    .digest("hex");
}

function readManifest(directory: string): CodemodPackageManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(join(directory, MANIFEST_FILE), "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${MANIFEST_FILE} in ${directory}`, { cause: error });
  }

  if (!isManifest(value)) {
    throw new Error(`Invalid ${MANIFEST_FILE} in ${directory}`);
  }
  return value;
}

function isManifest(value: unknown): value is CodemodPackageManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.schemaVersion === 1 &&
    nonEmptyString(manifest.packageName) &&
    nonEmptyString(manifest.fromVersion) &&
    nonEmptyString(manifest.toVersion) &&
    nonEmptyString(manifest.summary) &&
    manifest.runtime === "node" &&
    nonEmptyString(manifest.entrypoint) &&
    nonEmptyString(manifest.testEntrypoint)
  );
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validatePackageFiles(directory: string, manifest: CodemodPackageManifest): void {
  for (const path of [manifest.entrypoint, manifest.testEntrypoint]) {
    if (!isSafeRelativePath(path)) {
      throw new Error(`Codemod package path must stay inside its directory: ${path}`);
    }

    const stat = lstatSync(join(directory, path), { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw new Error(`Codemod package file does not exist: ${path}`);
    }
  }
}

function isSafeRelativePath(path: string): boolean {
  if (isAbsolute(path)) return false;
  const normalized = normalize(path);
  return (
    normalized !== ".." && !normalized.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}

function identityFrom(manifest: CodemodPackageManifest): CodemodIdentity {
  return {
    packageName: manifest.packageName,
    fromVersion: manifest.fromVersion,
    toVersion: manifest.toVersion,
  };
}

function validateIdentity(actual: CodemodIdentity, expected: CodemodIdentity): void {
  if (
    actual.packageName !== expected.packageName ||
    actual.fromVersion !== expected.fromVersion ||
    actual.toVersion !== expected.toVersion
  ) {
    throw new Error("Stored codemod manifest does not match its registry identity");
  }
}
