import { join } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import type { CallExpression, NewExpression } from "ts-morph";
import type { CallSite, Dependency } from "../types.ts";

export class Scanner {
  async findCallSites(repoPath: string, deps: Dependency[]): Promise<CallSite[]> {
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFilesAtPaths([
      join(repoPath, "**/*.{ts,tsx}"),
      `!${join(repoPath, "**/node_modules/**")}`,
    ]);

    const depNames = new Set(deps.map((dep) => dep.name));
    const callSites: CallSite[] = [];

    for (const sourceFile of project.getSourceFiles()) {
      const calls: (CallExpression | NewExpression)[] = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression),
      ];

      for (const call of calls) {
        const usage = this.resolveUsage(call, depNames);
        if (!usage) continue;

        callSites.push({
          dependency: usage.dependency,
          file: sourceFile.getFilePath(),
          line: call.getStartLineNumber(),
          snippet: call.getText(),
          apiSurface: usage.apiSurface,
        });
      }
    }

    return callSites;
  }

  // Resolves a call/new expression's callee to wherever it was actually
  // declared. If that's inside a scanned dependency's package in
  // node_modules, it's a real usage of that dependency's API surface -
  // however deep the call chain (`.option(...)` on a `Command` instance
  // counts, even though the instance, not the import, is what's called).
  private resolveUsage(
    call: CallExpression | NewExpression,
    depNames: Set<string>,
  ): { dependency: string; apiSurface: string } | null {
    const expr = call.getExpression();
    const nameNode = Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : expr;

    const symbol = nameNode.getSymbol();
    if (!symbol) return null;

    const target = symbol.getAliasedSymbol() ?? symbol;
    const declarationFile = target.getDeclarations()[0]?.getSourceFile().getFilePath();
    if (!declarationFile) return null;

    const dependency = this.dependencyOf(declarationFile, depNames);
    if (!dependency) return null;

    const apiSurface = Node.isPropertyAccessExpression(expr)
      ? `${this.typeName(expr.getExpression())}.${nameNode.getText()}`
      : nameNode.getText();

    return { dependency, apiSurface };
  }

  // Class/interface name of a node's type, e.g. the `Command` in
  // `app.option(...)` where `app: Command`. Prefers the type's alias name
  // (e.g. `type Assert = {...}`) over its own symbol - for a type alias to
  // an anonymous object literal, the literal's own symbol is TypeScript's
  // internal placeholder "__type", which is worse than useless as a label.
  // Falls back to the node's own text if neither is available.
  private typeName(node: Node): string {
    const type = node.getType();
    const name = type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName();
    return name && name !== "__type" ? name : node.getText();
  }

  // Maps a declaration's file path back to which scanned dependency owns
  // it, by checking for a `node_modules/<dep>/` path segment.
  private dependencyOf(filePath: string, depNames: Set<string>): string | null {
    for (const name of depNames) {
      if (filePath.includes(`/node_modules/${name}/`)) return name;
    }
    return null;
  }
}
