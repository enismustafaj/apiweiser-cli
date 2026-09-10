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

  private typeName(node: Node): string {
    const type = node.getType();
    const name = type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName();
    return name && name !== "__type" ? name : node.getText();
  }

  private dependencyOf(filePath: string, depNames: Set<string>): string | null {
    for (const name of depNames) {
      if (
        filePath.includes(`/node_modules/${name}/`) ||
        filePath.includes(`/node_modules/@types/${name}/`)
      ) {
        return name;
      }
    }
    return null;
  }
}
