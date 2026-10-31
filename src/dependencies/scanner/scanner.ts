import { join } from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import type { CallExpression, NewExpression, Program, SourceFile } from "ts-morph";
import type { CallSite, Dependency } from "../types.ts";
import type { Usage } from "./types.ts";

export class Scanner {
  async findCallSites(repoPath: string, deps: Dependency[]): Promise<CallSite[]> {
    // allowJs: plain JS and CommonJS require() resolve like TS imports.
    // maxNodeModuleJsDepth 2 (TypeScript's own default for JS projects) also
    // reads untyped packages' JS, so e.g. cors() and morgan() resolve.
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, maxNodeModuleJsDepth: 2 },
    });
    project.addSourceFilesAtPaths([
      join(repoPath, "**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"),
      `!${join(repoPath, "**/node_modules/**")}`,
      `!${join(repoPath, "**/{dist,build,coverage,.next,out}/**")}`,
      `!${join(repoPath, "**/*.min.js")}`,
    ]);

    const depNames = new Set(deps.map((dep) => dep.name));
    const program = project.getProgram();
    const callSites: CallSite[] = [];

    for (const sourceFile of project.getSourceFiles()) {
      for (const usage of this.usagesIn(sourceFile)) {
        const dependency = this.ownerOf(usage.nameNode, depNames, program);
        if (!dependency) continue;

        callSites.push({
          dependency,
          file: sourceFile.getFilePath(),
          line: usage.node.getStartLineNumber(),
          snippet: usage.node.getText(),
          apiSurface: usage.apiSurface(),
        });
      }
    }

    return callSites;
  }

  private usagesIn(sourceFile: SourceFile): Usage[] {
    return [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).map((c) => this.callUsage(c)),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression).map((c) => this.callUsage(c)),
      ...this.jsxUsages(sourceFile),
      ...this.heritageUsages(sourceFile),
      ...this.typeUsages(sourceFile),
    ];
  }

  // `fn(...)`, `new Cls(...)`, `obj.method(...)` - a member call is named by
  // obj's type, so every link of a fluent chain reports `Command.option`.
  private callUsage(call: CallExpression | NewExpression): Usage {
    const expr = call.getExpression();
    const isMember = Node.isPropertyAccessExpression(expr);
    const nameNode = isMember ? expr.getNameNode() : expr;
    return {
      nameNode,
      node: call,
      apiSurface: () =>
        isMember
          ? `${this.typeName(expr.getExpression())}.${nameNode.getText()}`
          : nameNode.getText(),
    };
  }

  // `<Provider>`, `<Combobox.Root />` - components used only as JSX are a
  // React app's main use of most UI packages. Lowercase tags (`<div>`) are
  // intrinsic elements, declared by @types/react for every app - skipped.
  private jsxUsages(sourceFile: SourceFile): Usage[] {
    return [
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ]
      .filter((element) => !/^[a-z]/.test(element.getTagNameNode().getText()))
      .map((element) => {
        const tag = element.getTagNameNode();
        return {
          nameNode: Node.isPropertyAccessExpression(tag) ? tag.getNameNode() : tag,
          node: element,
          apiSurface: () => `<${tag.getText()}>`,
        };
      });
  }

  // `class X extends React.Component`, `implements OnInit` - not calls, but
  // a base class or interface that changes breaks every subclass.
  private heritageUsages(sourceFile: SourceFile): Usage[] {
    return sourceFile.getDescendantsOfKind(SyntaxKind.HeritageClause).flatMap((clause) => {
      const keyword = clause.getToken() === SyntaxKind.ExtendsKeyword ? "extends" : "implements";
      return clause.getTypeNodes().map((typeNode) => {
        const expr = typeNode.getExpression();
        return {
          nameNode: Node.isPropertyAccessExpression(expr) ? expr.getNameNode() : expr,
          node: clause,
          apiSurface: () => `${keyword} ${expr.getText()}`,
        };
      });
    });
  }

  // `React.FC<Props>`, `Request` - a removed or reshaped type breaks the
  // build as surely as a removed function.
  private typeUsages(sourceFile: SourceFile): Usage[] {
    return sourceFile.getDescendantsOfKind(SyntaxKind.TypeReference).map((reference) => {
      const typeName = reference.getTypeName();
      return {
        nameNode: Node.isQualifiedName(typeName) ? typeName.getRight() : typeName,
        node: reference,
        apiSurface: () => typeName.getText(),
      };
    });
  }

  // The dependency that declares what nameNode refers to, following import
  // aliases to the real declaration.
  private ownerOf(nameNode: Node, depNames: Set<string>, program: Program): string | null {
    const symbol = nameNode.getSymbol();
    if (!symbol) return null;

    const target = symbol.getAliasedSymbol() ?? symbol;
    const declarationFile = target.getDeclarations()[0]?.getSourceFile();
    if (!declarationFile) return null;
    // TypeScript's own lib.*.d.ts (console, Array, Promise, ...) are served
    // from node_modules/typescript/lib - they're the language, not the
    // typescript package's API.
    if (program.compilerObject.isSourceFileDefaultLibrary(declarationFile.compilerNode)) {
      return null;
    }

    return this.dependencyOf(declarationFile.getFilePath(), depNames);
  }

  private typeName(node: Node): string {
    const type = node.getType();
    const name = type.getAliasSymbol()?.getName() ?? type.getSymbol()?.getName();
    // __type, __object, __function: TypeScript's names for anonymous types
    // (a JS `module.exports = { sign }` is __object) - the code's own text
    // (`jwt.sign`) says more.
    return name && !name.startsWith("__") && !name.startsWith('"') ? name : node.getText();
  }

  // The package that owns the declaring file - the last node_modules
  // segment, so a nested copy (a/node_modules/b) counts as b.
  private dependencyOf(filePath: string, depNames: Set<string>): string | null {
    const match = filePath.match(/.*\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (!match) return null;
    const owner = match[1]!;
    if (!owner.startsWith("@types/")) return depNames.has(owner) ? owner : null;

    const typed = owner.slice("@types/".length).replace(/^(.+)__/, "@$1/");
    if (depNames.has(typed)) return typed;
    if (depNames.has(owner)) return owner;

    // Types split into a helper package, e.g. express's app/req/res live in
    // @types/express-serve-static-core: credit the longest dependency the
    // helper's name extends.
    // ponytail: a name-prefix heuristic, it would wrongly credit a dep whose
    // name merely prefixes an unrelated @types package's. Walk the @types
    // packages' own dependencies if that ever shows up.
    const owners = [...depNames].filter((name) => typed.startsWith(`${name}-`));
    return owners.sort((a, b) => b.length - a.length)[0] ?? null;
  }
}
