# Dashboard

`src/dashboard/` — a local, read-only view over the same
`~/.apiweiser-cli/db.sqlite` every other module writes to: what packages
are known, what Renovate suggested, and what PRs have actually been opened
(see [`docs/database.md`](./database.md)).

```
src/dashboard/
  db/dashboard-repository.ts   class DashboardRepository
  server.ts                    createServer(db): Hono
  index.ts                     class DashboardModule
```

## Running it

```
apiweiser-cli dashboard [--port <port>]   # default 3000
```

A foreground command, not a scheduler - it binds a port and runs until
Ctrl+C, same as running any other local dev server. It reads the same
`db` singleton every other module uses (see
[`docs/database.md`](./database.md)), so it reflects whatever the
schedulers have already written - it never scans or writes anything
itself.

## `DashboardRepository`

Its own repository, not bolted onto `PackagesRepository`/
`SuggestionsRepository`/`PullRequestsRepository` - those are shaped around
what each module needs to _write_; this one only reads, across every repo
the CLI has ever scanned (`packages`/`suggestions`/`pull_requests` aren't
scoped to one repo path from a dashboard's point of view - the whole point
is seeing everything at once).

```ts
listPackages(): PackageRow[]           // every (repo_path, package) row
listSuggestions(): SuggestionRow[]     // newest scanned first
listPullRequests(): PullRequestRow[]   // newest opened first
```

## `createServer(db)`

Framework: [Hono](https://hono.dev), via `@hono/node-server` to bind it to
Node's actual HTTP server. Currently exposes the same three lists as JSON:

- `GET /api/packages`
- `GET /api/suggestions`
- `GET /api/pull-requests`

**No JSX**: Node's native TS stripping (this repo's whole no-build-step dev
workflow - see the top-level README) only strips type annotations, it
doesn't transform syntax, so `hono/jsx`'s `.tsx` files can't run directly
the way every other module here does under plain `node file.ts`. The HTML
pages that will sit on top of these JSON routes use plain string templates
and [Pico.css](https://picocss.com) instead, not JSX - see the routes above
once they exist.

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
