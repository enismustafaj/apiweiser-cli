# Dashboard

`src/dashboard/` — a local, read-only, server-rendered view over the same
`~/.apiweiser-cli/db.sqlite` every other module writes to: what packages
are known, what Renovate suggested, and what PRs have actually been opened
(see [`docs/database.md`](./database.md)).

```
src/dashboard/
  types.ts                      Page<T>, PackageRow, SuggestionRow, PullRequestRow, Tab
  db/dashboard-repository.ts   class DashboardRepository
  pages.ts                     dashboardPage(packages, suggestions, pullRequests, activeTab)
  server.ts                    createServer(db): Hono
  index.ts                     class DashboardModule
  static/
    style.css                   Pico.css overrides + the CSS-only tabs/pagination
    logo.png                     APIWeiser logo, shown in the header
```

## Running it

```
apiweiser-cli dashboard [--port <port>]   # default 3000
```

A foreground command, not a scheduler - it binds a port and runs until
Ctrl+C, same as running any other local dev server. It reads the same `db`
singleton every other module uses (see [`docs/database.md`](./database.md)),
so it reflects whatever the schedulers have already written - it never
scans or writes anything itself.

## `DashboardRepository`

Its own repository, not bolted onto `PackagesRepository`/
`SuggestionsRepository`/`PullRequestsRepository` - those are shaped around
what each module needs to _write_; this one only reads, across every repo
the CLI has ever scanned (`packages`/`suggestions`/`pull_requests` aren't
scoped to one repo path from a dashboard's point of view - the whole point
is seeing everything at once).

```ts
listPackages(page: number): Page<PackageRow>           // every (repo_path, package) row
listSuggestions(page: number): Page<SuggestionRow>     // newest scanned first
listPullRequests(page: number): Page<PullRequestRow>   // newest opened first
```

`page` is 1-based; `Page<T>` is `{ rows, page, totalPages, total }`. All
three share one `paginate()` private helper (same shape: a plain table, no
filters, just a different query and a fixed `PAGE_SIZE` of 20) - a `COUNT(*)`
plus a `LIMIT ? OFFSET ?`, run as two separate queries rather than a single
window-function query, since these tables are small enough that the extra
round trip doesn't matter and two plain queries are easier to read. An
out-of-range page number (or a garbage one - see `server.ts`'s `pageParam`)
just comes back with an empty `rows`, not an error.

## Server-rendered, not a JSON API + client fetch

`pages.ts` builds the whole page - stats, all three tables - straight from
`DashboardRepository`'s query results, on the server, for every request.
There's no `/api/*` JSON endpoint and no client-side fetch/render step: the
browser gets a complete, populated HTML document on `GET /`.

**No JSX**: Node's native TS stripping (this repo's whole no-build-step dev
workflow - see the top-level README) only strips type annotations, it
doesn't transform syntax - verified directly:

```
$ node --experimental-strip-types jsx-test.tsx
SyntaxError: Unexpected token '<'
```

so `hono/jsx`'s `.tsx` files can't run the same zero-build way every other
module here does under plain `node file.ts`. Reaching for real JSX would
mean adding a compiler (tsc/esbuild) and a dev-time watcher just for this
one module, while the rest of the CLI keeps running unbuilt - a real
inconsistency, not worth it for one dashboard page.

Instead, `pages.ts` uses Hono's own [`html` tagged
template](https://hono.dev/docs/helpers/html) (`import { html } from
"hono/html"`) - same composable, auto-escaping ergonomics as JSX (functions
returning a fragment, fragments nesting into each other, arrays of
fragments flattening automatically), just template literals instead of a
JSX transform, so it runs exactly the same way as every other `.ts` file in
this repo.

## CSS-only tabs

The three sections (Packages/Suggestions/Pull requests) are all rendered
into the page at once and switched between with three hidden radio inputs
plus `:checked ~` sibling selectors in `static/style.css` - no
client-side JS at all. Consistent with server-rendering the whole page:
there's no client-side state to manage, so there's no reason to reach for
a script just to toggle which `<section>` is visible.

## Pagination, also links rather than JS

Same reasoning as the tabs: the page is already fully server-rendered, so
"Prev"/"Next" are plain `<a href="/?tab=...&packagesPage=...&...">` links,
not a client-side fetch-more. Each of the three tables paginates
independently, `PAGE_SIZE` (20) rows at a time.

The query string carries all four bits of state at once - `tab`,
`packagesPage`, `suggestionsPage`, `pullRequestsPage` - because the three
tables are independent (paging through Suggestions shouldn't reset
whichever page you'd scrolled Packages to) and because `tab` needs to
survive the reload too: following a pagination link is a real navigation,
so without `tab` in the URL the page would always re-render with the
Packages tab pre-selected, even if you were paging through Pull requests.
`server.ts` reads all four off `c.req.query()`; `pages.ts`'s `hrefFor`
builds links that keep the other three untouched and only change the one
being paged.

## `createServer(db)`

Two things mounted on the Hono app:

- `GET /` - reads `tab`/`packagesPage`/`suggestionsPage`/`pullRequestsPage`
  off the query string, calls `DashboardRepository`'s three list methods
  with the requested page, and returns `dashboardPage(...)` via
  `c.html(...)`.
- `static/` (Pico.css overrides, the tab/pagination CSS, and the logo), via
  `@hono/node-server/serve-static`, mounted at `/*` after the `/` route.

`serveStatic`'s `root` is resolved from `import.meta.dirname`, not
`process.cwd()` - the dashboard command needs to work no matter which
directory it's launched from (verified: works identically run from this
repo's root and from `/tmp`). The build step (`npm run build`) copies
`src/dashboard/static` to `dist/dashboard/static` alongside the compiled
`.js` - `tsc` only emits `.ts` files, it won't move static assets on its
own.

## `DashboardModule.start(port)`

`@hono/node-server`'s `serve({ fetch: app.fetch, port })`. Logs the URL and
returns the underlying server handle.

## Wiring

`src/main.ts` is now two subcommands rather than one flat command:

- `apiweiser-cli scan --path <path>` - the original scan-and-schedule
  behavior. Registered with `commander`'s `isDefault: true`, so the
  existing `apiweiser-cli --path <path>` invocation still works unchanged;
  `scan` only needs to be typed explicitly to see `--help` for it
  specifically.
- `apiweiser-cli dashboard [--port <port>]` - this module.
