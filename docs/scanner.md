# Scanner

`src/dependencies/scanner/scanner.ts` — `Scanner.findCallSites(repoPath, deps)`

Given a repo path and the list of `Dependency` objects produced by
[`SbomTool`](../src/dependencies/tool/sbom-tool.ts), the scanner finds every
place in the repo's TypeScript source where one of those dependencies is
actually *invoked*, and which exported member was called (the "API
surface"). It returns `CallSite[]`:

```ts
interface CallSite {
  dependency: string;   // package name, e.g. "commander"
  file: string;          // absolute path of the source file
  line: number;           // 1-based line of the call
  snippet: string;         // source text of the call expression
  apiSurface: string;      // the member invoked, e.g. "Command" or "Command.option"
}
```

## Algorithm

1. **Load the repo into a ts-morph `Project`.**
   `project.addSourceFilesAtPaths([join(repoPath, "**/*.{ts,tsx}"), "!**/node_modules/**"])`
   picks up every `.ts`/`.tsx` file under `repoPath`, excluding
   `node_modules`. No `tsconfig.json` is required
   (`skipAddingFilesFromTsConfig: true`) — this keeps the scanner usable on
   any repo regardless of its build setup.

2. **Collect every call in the file.**
   For each source file, gather all `CallExpression` and `NewExpression`
   nodes (`fn(...)` and `new Cls(...)`), with no filtering on what's being
   called yet.

3. **Resolve each call's callee back to where it was declared.**
   For a call `expr(...)`, the callee node is either an identifier
   (`fn(...)`) or a property access (`obj.method(...)`, in which case the
   *name* node — `method` — is what's resolved). `nameNode.getSymbol()` asks
   ts-morph's language service for the symbol backing that identifier, and
   if it's an import alias, `symbol.getAliasedSymbol()` follows it to the
   real declaration. That declaration's source file is then checked for a
   `node_modules/<dependency>/` path segment against the scanned
   dependency names.

4. **Label the API surface.**
   - Direct call/construction (`fn(...)`, `new Cls(...)`) → `apiSurface` is
     just the callee name (`"execFile"`, `"Command"`).
   - Member call (`obj.method(...)`) → `apiSurface` is
     `"<TypeName>.<method>"`, where `<TypeName>` is the *type* of `obj`
     (`app.getType().getSymbol()?.getName()`), not `obj`'s variable name.
     This is what makes chained calls work: `app.option(...)` reports
     `"Command.option"` because `app`'s type is `Command`, even though
     `Command` itself isn't referenced anywhere on that line.

Because resolution is driven by the type checker rather than by tracing
`import` bindings syntactically, a call several links into a fluent chain —
`new Command().name(...).description(...).option(...)` — is caught at every
link: each `.method(...)` call's declaration still resolves into
`commander`'s package in `node_modules`, regardless of how the value it's
called on was produced.

## What it deliberately does not do

- **No JS support.** Only `.ts`/`.tsx` files are scanned; plain `.js`/`.jsx`
  call sites are invisible to this scanner.
- **Whole-chain snippets.** `snippet` is the source text of the resolved
  call/`new` expression node. For a call late in a chain, that node's range
  covers everything before it too (`app.name(...).description(...).option(...)`
  is the snippet for the `.option` call site, not just `.option(...)`) —
  it's how TypeScript's AST represents chained calls, not something the
  scanner strips out.
- **No cross-file symbol renaming beyond what the type checker already
  resolves.** If the checker can't resolve a symbol (e.g. untyped JS
  interop, `any`-typed values), that call is silently skipped rather than
  guessed at.

## Example

For this repo's own `src/main.ts`:

```ts
import { Command } from "commander";
const app = new Command()
app.name("apiweiser-scanner")
  .description("")
  .option("-p, --path <path>", "project path")
app.parse(process.argv)
const opts = app.opts();
```

Running `new Scanner().findCallSites(".", [{ name: "commander", ... }])`
returns one call site per link in the chain, plus the constructor call:

```js
[
  { apiSurface: "Command.option", line: 6, ... },
  { apiSurface: "Command.description", line: 6, ... },
  { apiSurface: "Command.name", line: 6, ... },
  { apiSurface: "Command.parse", line: 10, ... },
  { apiSurface: "Command.opts", line: 12, ... },
  { apiSurface: "Command", line: 4, snippet: "new Command()" },
]
```
