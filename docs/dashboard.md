# Dashboard

`src/dashboard/` — a local, read-only, server-rendered view over the same
`~/.apiweiser-cli/db.sqlite` every other module writes to: which repos
have been scanned, each repo's direct dependencies, and the migration PRs
opened for it
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
what each module needs to _write_; this one only reads.

- `repoSummaries(repo?)` - the repo list: every repo with packages or PRs
  (a PR can outlive a re-scan), with its direct dependency and PR counts. Given a `repo`, just that one - its
  counts are the numbers on the cards. A group PR is one `pull_requests`
  row per package, so PRs are counted by distinct URL.

Every list method takes a filter object plus a 1-based page number and
returns a `Page<T>` (`{ rows, page, totalPages, total }`, `PAGE_SIZE` of 20):

- `listPackages({ repo, q })` - direct dependencies only, by name.
  Transitive ones aren't something the pipeline acts on yet.
- `listPullRequests({ repo, q })` - one row per PR, newest first. A group
  PR is stored as one row per package; they're gathered back up with
  `json_group_array` so the PR shows once, listing every package it bumps.
  `q` matches any of its packages and still returns the whole PR.

Renovate's suggestions aren't shown: they're an intermediate step towards
a PR, not something to act on from here.

Filters are written as `($x IS NULL OR col = $x)` with named parameters, so
each query is one fixed statement rather than a WHERE clause assembled from
pieces; an undefined filter is passed as `NULL`. `q` is a substring match
with LIKE's own `%`/`_` escaped, so searching `foo_bar` doesn't also match
`fooXbar`.

The count and the page are still two plain queries sharing one WHERE clause
(`paginate()`), and an out-of-range page (or a garbage one - see
`server.ts`'s `pageParam`) just comes back with empty `rows`, not an error.

## Server-rendered, not a JSON API + client fetch

`pages.ts` builds the whole page - cards and table - straight from
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

`/` is the repo list. Picking a repo opens its view, with two summary
cards (dependencies, pull requests) that _are_ the tabs - each number is also
the way into its list, so there's no separate tab bar repeating them. Only
the active tab is queried and rendered. The brand in the top bar, and
"← All repositories" above the heading, go back to the list.

All state lives in the query string, and every control is a plain link or a
`method="get"` form, so any view can be bookmarked or shared and the back
button works:

| Param  | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| `repo` | Absolute repo path. Absent or unknown: the repo list.                   |
| `tab`  | `packages` (default) or `pull-requests`. `suggestions`/`updates` → PRs. |
| `q`    | Search by dependency name                                               |
| `page` | 1-based page of the active tab                                          |

Switching tabs keeps `repo` and drops the rest. The only script on the page
is `/` focusing the search box.

Repo paths are absolute and can run to hundreds of characters, so the repo
list shows the directory name with the full path underneath, truncated,
and a repo's view names it once in the top bar and the heading.

## Styling

`static/style.css` is the whole design - no CSS framework. It's a set of
colour/radius/font tokens on `:root`, dark by default and switched to a
light palette under `prefers-color-scheme: light`, with Geist and Geist
Mono loaded from Google Fonts (falling back to the system UI and monospace
fonts offline). The metrics strip and the toolbar/table/pagination card are
plain elements styled there.

The stylesheet is linked as `/style.css?v=<hash>`, a hash of its contents
taken at startup. `serveStatic` sends no cache headers, so without it
browsers keep reusing a stale copy after the CSS changes.

The top bar uses `logo-mark.png`, the `{◎}` mark cropped out of `logo.png`,
next to the wordmark set in text. Both images are black on transparent, so
the mark is inverted on the dark theme.

## `createServer(db)`

Two things mounted on the Hono app:

- `GET /` - `parseState()` turns the query string into a `DashboardState`
  (validating `tab`/`page`, and only accepting a `repo` that's in
  `repoSummaries()`). With no valid repo it renders `reposPage(...)`;
  otherwise `tabContent()` runs just the queries the active tab needs and
  `repoPage(...)` renders it.
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
