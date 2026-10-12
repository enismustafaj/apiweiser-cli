# Dashboard

`src/dashboard/` — a local, read-only, server-rendered view over the same
`~/.apiweiser-cli/db.sqlite` every other module writes to: which
dependencies a repo has and how heavily its code calls them, what Renovate
suggested, and what PRs have actually been opened
(see [`docs/database.md`](./database.md)).

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
what each module needs to _write_; this one only reads, and every query is a
"show me everything that matches" report across whichever repos are
selected.

Every list method takes a filter object plus a 1-based page number and
returns a `Page<T>` (`{ rows, page, totalPages, total }`, `PAGE_SIZE` of 20):

- `listPackages({ repo, q, type })` - direct dependencies first, then by
  call-site count, then name. Each row carries its call-site count.
- `listCallSiteUsage({ repo, q })` - one row per package that has call
  sites: how many, across how many files, using how many distinct APIs.
- `listCallSites({ repo, q, packageName, api })` - one package's call
  sites, `file` made relative to `repo_path` (stored absolute, it repeats a
  potentially very long repo path on every row). `q` searches the file path
  and the snippet.
- `listSuggestions({ repo, q })`, `listPullRequests({ repo, q })` - newest
  first.

Plus the non-paginated pieces the page needs around them: `listRepos()`
(every repo any table has a row for - a suggestion or PR can outlive a
re-scan), `summary(repo)` (the numbers on the cards),
`packageTypeCounts(filter)` (the Direct/Transitive/All toggle labels), and
`apiSurfaceCounts(repo, packageName)` (the API chips on a package's
call-site view).

Filters are written as `($x IS NULL OR col = $x)` with named parameters, so
each query is one fixed statement rather than a WHERE clause assembled from
pieces; an undefined filter is passed as `NULL`. `q` is a substring match
with LIKE's own `%`/`_` escaped, so searching `foo_bar` doesn't also match
`fooXbar`. Call-site counts are `LEFT JOIN`ed from a grouped subquery rather than counted per row - `call_sites` has no index on
`package_id`, and a real scan (got) has 10.7k rows.

The count and the page are still two plain queries sharing one WHERE clause
(`paginate()`), and an out-of-range page (or a garbage one - see
`server.ts`'s `pageParam`) just comes back with empty `rows`, not an error.

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

## Navigation: everything is a link or a GET form

The four summary cards at the top (direct dependencies, call sites,
suggested updates, PRs opened) _are_ the tabs - each number is also the way
into its list, so there's no separate tab bar repeating the same four
things. Only the active tab is queried and rendered.

All state lives in the query string, and every control is a plain link or a
`method="get"` form, so any view can be bookmarked or shared and the back
button works:

| Param     | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `tab`     | `packages` (default), `call-sites`, `suggestions`, `pull-requests`                           |
| `repo`    | Absolute repo path. Absent: the only repo if there's exactly one, otherwise all. Empty: all. |
| `q`       | Search. Package/dependency name, or file path and code on a package's call-site view.        |
| `type`    | Packages only: `direct` (default), `transitive`, or `all`                                    |
| `package` | Call sites only: drill into one package                                                      |
| `api`     | Call sites only: narrow a package's call sites to one API                                    |
| `page`    | 1-based page of the active tab                                                               |

Switching tabs keeps `repo` and `q` and drops the rest. Script on the page
is limited to conveniences on top of that: the repo picker's
`onchange="this.form.submit()"` (with a `<noscript>` submit button - it's
still just a GET form), and `/` focusing the search box.

Some choices made against a real scan (got: 773 packages, 10.7k call sites):

- **Direct dependencies by default.** Transitive ones outnumber them ~15:1
  and are rarely what anyone came to look at; the toggle shows all three
  counts so nothing is hidden.
- **Repo shown once, not per row.** Repo paths are absolute and can run to
  hundreds of characters. With one repo selected, it's named in the header
  and the Repo column disappears; across repos, the column shows the
  directory name with the full path on hover.
- **Snippets fold.** A call-site snippet is whatever expression the scanner
  matched, which can be a 100-line chained call. The table shows its first
  line and a `<details>` expands the rest.
- **API chips.** A package's call-site view leads with which of its APIs
  the code uses, most-used first - the quickest read on how painful a
  breaking release would be. Past 12 they fold into "N more".

## Styling

`static/style.css` is the whole design - no CSS framework. It's a set of
colour/radius/font tokens on `:root`, dark by default and switched to a
light palette under `prefers-color-scheme: light`, with Geist and Geist
Mono loaded from Google Fonts (falling back to the system UI and monospace
fonts offline). The metrics strip, the toolbar/table/pagination card, the
segmented Direct/Transitive/All control, and the call-site usage bars
(scaled against the largest count on the current page) are all plain
elements styled there.

The top bar uses `logo-mark.png`, the `{◎}` mark cropped out of `logo.png`,
next to the wordmark set in text. Both images are black on transparent, so
the mark is inverted on the dark theme.

## `createServer(db)`

Two things mounted on the Hono app:

- `GET /` - `parseState()` turns the query string into a `DashboardState`
  (validating `tab`/`type`/`page`, and only accepting a `repo` that's in
  `listRepos()`), `tabContent()` runs just the queries the active tab
  needs, and `dashboardPage(...)` renders it via `c.html(...)`.
- `static/` (the stylesheet and the logo), via
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
