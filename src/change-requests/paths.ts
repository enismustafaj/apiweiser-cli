import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CallSite } from "../dependencies/types.ts";

export function repositoryRelativePath(repoPath: string, path: string): string {
  const repository = resolve(repoPath);
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(repository, path);
  const relativePath = relative(repository, absolutePath);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Path is outside repository: ${path}`);
  }
  return relativePath;
}

export function repositoryRelativeCallSites(repoPath: string, callSites: CallSite[]): CallSite[] {
  return callSites.map((callSite) => ({
    ...callSite,
    file: repositoryRelativePath(repoPath, callSite.file),
  }));
}
