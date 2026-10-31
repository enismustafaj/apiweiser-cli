# Scanner

`src/dependencies/scanner/scanner.ts` — `Scanner.findCallSites(repoPath, deps)`

Given a repo path and the list of `Dependency` objects produced by
[`SbomTool`](../src/dependencies/sbom/sbom-tool.ts), the scanner finds every
place in the repo's TypeScript or JavaScript source where one of those
dependencies is actually _used_, and what was used (the "API surface"). It
returns a `CallSite[]`, one entry per resolved usage:

| field        | notes                               |
| ------------ | ----------------------------------- |
| `dependency` | package name, e.g. `"commander"`    |
| `file`       | absolute path of the source file    |
| `line`       | 1-based line of the call            |
| `snippet`    | source text of the call expression  |
| `apiSurface` | what was used - see the table below |

## Algorithm

1. **Load the repo into a ts-morph `Project`.** Every
   `.ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs` file under `repoPath`, excluding
   `node_modules`, build output (`dist`, `build`, `coverage`, `.next`,
   `out`) and `*.min.js`. No `tsconfig.json` is required
   (`skipAddingFilesFromTsConfig: true`) — this keeps the scanner usable on
   any repo regardless of its build setup. `allowJs` makes plain JS and
   CommonJS `require()` resolve like TS imports, and
   `maxNodeModuleJsDepth: 2` (TypeScript's own default for JS projects)
   also reads untyped packages' own JS, so `cors()` or `jwt.sign()` resolve
   without an `@types` package. On a JS Express app that took call sites
   from 0 to 268, at no measurable cost (under a second).

2. **Collect every usage in the file**, with no filtering on what's being
   used yet:

   | kind           | example                                             | `apiSurface`                                   |
   | -------------- | --------------------------------------------------- | ---------------------------------------------- |
   | call / `new`   | `app.option(...)`, `new Command()`                  | `Command.option`, `Command`                    |
   | JSX component  | `<Combobox.Root>`, `<Button />`                     | `<Combobox.Root>`, `<Button>`                  |
   | heritage       | `class X extends React.Component implements OnInit` | `extends React.Component`, `implements OnInit` |
   | type reference | `req: express.Request`, `React.FC<Props>`           | `express.Request`, `React.FC`                  |

   Lowercase JSX tags (`<div>`) are intrinsic elements - declared by
   `@types/react` for every app - so they're skipped. Closing tags aren't
   counted; the opening element is.

3. **Resolve each usage back to where it was declared.**
   For a call `expr(...)`, the callee node is either an identifier
   (`fn(...)`) or a property access (`obj.method(...)`, in which case the
   _name_ node — `method` — is what's resolved); the same goes for a JSX
   tag, a heritage expression, and the right side of a qualified type name
   (`React.FC` resolves `FC`). `nameNode.getSymbol()` asks
   ts-morph's language service for the symbol backing that identifier, and
   if it's an import alias, `symbol.getAliasedSymbol()` follows it to the
   real declaration. That declaration's source file decides the owner:
   - TypeScript's own `lib.*.d.ts` (`console`, `Array`, `Promise`, ...) are
     skipped - ts-morph serves them from `node_modules/typescript/lib/`, but
     they're the language, not the `typescript` package's API.
   - Otherwise the owner is the package of the _last_ `node_modules/<name>/`
     segment, so a nested copy (`a/node_modules/b`) counts as `b`.
   - A declaration in `@types/<name>` is credited to `<name>` when that's a
     dependency (even if `@types/<name>` is one too - the code calls
     enzyme, `@types/enzyme` only describes it), else to `@types/<name>`
     itself (`@types/node`). `@types/babel__core` maps to `@babel/core`.
   - A declaration in a helper `@types` package that isn't a dependency, like
     express's app/req/res in `@types/express-serve-static-core`, is
     credited to the longest dependency whose name it extends (`express`).

4. **Label the API surface.**
   - Direct call/construction (`fn(...)`, `new Cls(...)`) → `apiSurface` is
     just the callee name (`"execFile"`, `"Command"`).
   - Member call (`obj.method(...)`) → `apiSurface` is
     `"<TypeName>.<method>"`, where `<TypeName>` is the _type_ of `obj`
     (`app.getType().getSymbol()?.getName()`), not `obj`'s variable name -
     except where that type has no useful name: a module namespace
     (`import * as bcrypt`), whose type symbol is named by its quoted file
     path, and TypeScript's anonymous `__type`/`__object` (a JS
     `module.exports = { sign }`). Those fall back to the code's own text
     (`bcrypt.hash`, `jwt.sign`).
   - JSX, heritage and type references → the source text, as in the table
     above.
     This is what makes chained calls work: `app.option(...)` reports
     `"Command.option"` because `app`'s type is `Command`, even though
     `Command` itself isn't referenced anywhere on that line.

Because resolution is driven by the type checker rather than by tracing
`import` bindings syntactically, a call several links into a fluent chain —
`new Command().name(...).description(...).option(...)` — is caught at every
link: each `.method(...)` call's declaration still resolves into
`commander`'s package in `node_modules`, regardless of how the value it's
called on was produced.

## devDependencies aren't scanned at all

`scan` filters out `isDevDependency` dependencies (see
[`SbomTool`](../src/dependencies/sbom/sbom-tool.ts): a package is dev when
no runtime dependency reaches it) before calling `findCallSites` - dev
tooling doesn't get "called" from application code the way a runtime
dependency does, and even where it technically resolves (e.g.
`@types/react`'s JSX/prop types, used throughout `.tsx` files), that isn't a
real API call worth migrating with a codemod. With no call sites, `codemod`
gives such a package no `codemodDir` - there's nothing to migrate.

## What it deliberately does not do

- **No Vue or Svelte support.** `.vue`/`.svelte` single-file components
  aren't read - their `<script>` blocks would need extracting first.
- **Runtime-attached APIs stay invisible.** A package that builds its API
  at runtime (express's `app.use`, mixed into the app object, without
  `@types/express`) has no declaration to resolve, so those calls are
  skipped rather than guessed at.
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

Scanning this repo's own `src/main.ts` - which constructs a `commander`
`Command`, then chains `.name(...)`, `.description(...)`, and
`.option(...)` off it before separately calling `.parse(...)` and
`.opts()` - `Scanner.findCallSites` returns one call site per link in the
chain, plus the constructor call itself: `Command.option`,
`Command.description`, and `Command.name` all on the chain's line;
`Command.parse` and `Command.opts` on their own, later lines; and a
`Command` entry (no member - the constructor call) with `new Command()` as
its snippet.
