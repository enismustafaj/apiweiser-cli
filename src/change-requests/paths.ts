import { isAbsolute, relative, resolve } from "node:path";

export function repositoryRelativePath(repoPath: string, path: string): string {
  const repository = resolve(repoPath);
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(repository, path);
  const relativePath = relative(repository, absolutePath);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Path is outside repository: ${path}`);
  }
  return relativePath;
}
