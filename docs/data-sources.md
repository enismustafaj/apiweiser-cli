# Data sources

`src/data-sources/` — for packages the SBOM scan has never seen before,
derives where to fetch their release changelog from, using npm registry
metadata only (no LLM). Lookups are queued and drained in rate-limit-sized
batches on a schedule, not done inline during a scan.

```
src/data-sources/
  types.ts                                PendingLookup, NpmPackageManifest
  npm-registry-lookup.ts                  class NpmRegistryLookup
  db/pending-changelog-lookups-repository.ts  class PendingChangelogLookupsRepository(db)
  db/data-sources-repository.ts           class DataSourcesRepository(db)
  index.ts                                class DataSourcesModule
  scheduler.ts                            class Scheduler(cronExpr)
```

## Why a queue instead of looking up inline

An earlier version of this module called an LLM per new dependency,
synchronously, during `scan()`. Two problems, found by actually running it
against a real repo (769 dependencies): a single `--path` run could take
9–15+ minutes, and firing that many requests back-to-back reliably hit
rate limits partway through (both the npm registry's, when this module was
switched to registry lookups instead of an LLM, and the LLM provider's, in
the version before that).

So `scan()` doesn't look anything up anymore. It only **enqueues** new
packages into `pending_changelog_lookups` (a plain insert, no network
call) and returns immediately — a scan of the same 769-dependency repo
went from 9–15+ minutes to ~6.6 seconds. A separate `Scheduler` drains the
queue later, in batches sized to what the npm registry can actually take
per tick.

## Why only _new_ packages get queued

`DependenciesModule.scan()` computes two different sets from the SBOM's
dependency list (see `PackagesRepository`, documented in
[`docs/database.md`](./database.md)):

- `findChangedOrNew` — new **or** version-bumped, drives whether `Scanner`
  re-scans a package's call sites.
- `findNew` — new only, no `packages` row at all before this scan. This is
  what gets queued.

A package that's already known and just had a version bump doesn't need
its changelog source looked up again — the _source_ (its GitHub repo)
doesn't change between versions, only the version does.

## `NpmRegistryLookup.findChangelogSource(packageName)`

`GET https://registry.npmjs.org/<name>/latest`, reads the manifest's
`repository` field, and normalizes whatever shape it's in (`git+https://`,
`git+ssh://git@`, `git@github.com:`, `github:owner/repo`, or a bare
`owner/repo` — npm's documented default-to-GitHub shorthand) down to
`owner/repo`. Returns the **GitHub API** releases endpoint —
`https://api.github.com/repos/<owner>/<repo>/releases` — not the HTML
releases page, because the API endpoint is actually fetchable JSON (tag,
body, `published_at` per release) rather than a page meant for a browser.

**Verified against 769 real dependencies** (a full scan of
[sindresorhus/got](https://github.com/sindresorhus/got)): 768 resolved
(99.9%). The one miss, `micro-spelling-correcter`, has no `repository`
field in its npm metadata at all — there's nothing to derive from, for
anyone.

Three outcomes, each meaning something different to the caller:

| Response                          | Return   | Meaning                              |
| --------------------------------- | -------- | ------------------------------------ |
| `404`                             | `null`   | Package genuinely not found          |
| `200`, no resolvable `repository` | `null`   | No GitHub source exists — definitive |
| anything else (`429`, `5xx`, ...) | _throws_ | Transient failure, not "no data"     |

That last distinction matters: early on, any non-`200` response was
treated as `null`, indistinguishable from "no repository field". A burst
of testing this module inadvertently rate-limited itself against the
npm registry, and the resulting `null`s were misread as real coverage
gaps (a measured "resolved: 694/769" that looked like a regression, but
was actually just unhandled 429s). Now only a real 404 (or clean 200 with
no usable data) returns `null`; everything else throws.

## `pending_changelog_lookups` (the queue)

See [`docs/database.md`](./database.md) for the column list.
`PendingChangelogLookupsRepository`:

- `enqueue(dependencies)` — `INSERT OR IGNORE`, keyed by `UNIQUE package_id`.
  A package already queued from an earlier scan just stays queued once.
- `takeBatch(limit)` — oldest-queued first, capped at `limit`.
- `remove(pendingId)` — called once a lookup is _resolved_, whether that
  resolution is a URL or a definitive "no source".

## `DataSourcesModule`

```ts
enqueueForLookup(dependencies: Dependency[]): void
```

Called by `DependenciesModule.scan()` with the "new only" set, after
`PackagesRepository.upsert()` has run (so each `Dependency.id` is set —
see the `RETURNING id` note in [`docs/database.md`](./database.md)). Pure
insert via `PendingChangelogLookupsRepository`, no network call, no
`await` needed.

```ts
async processPendingLookups(): Promise<void>
```

One scheduler tick:

1. Claims up to `BATCH_SIZE` (50 — npm doesn't publish an official rate
   limit for the public registry; this is a conservative budget based on
   empirically getting `429`s after a few hundred rapid sequential
   requests) pending entries, oldest first.
2. For each, calls `NpmRegistryLookup.findChangelogSource(packageName)`:
   - **Resolves to a URL** → recorded, and the entry is removed from the
     queue.
   - **Resolves to `null`** (no repository data — a definitive answer) →
     logged via `console.log`, and the entry is **still removed** from the
     queue. There's nothing to retry; leaving it queued would just burn
     one of every future tick's budget on a package that will never
     resolve.
   - **Throws** (network failure, `429`, ...) → logged via
     `console.error`, entry **stays queued** for the next tick.
3. Whatever resolved to a URL this tick is written to `data_sources` in
   one `DataSourcesRepository.insert()` call.

## `DataSourcesRepository.insert(sources)`

`Map<packageId, url>` → `INSERT INTO data_sources (package_id, url) VALUES (?, ?)`
per entry — no subquery, since callers already have the id on hand. See
[`docs/database.md`](./database.md) for why this one doesn't need the
by-name subquery `CallSitesRepository` uses.

## `Scheduler`

Same shape as `suggestions/scheduler.ts`: wraps `node-cron`'s `createTask`
so the task exists but sits idle until `.start()`, and each tick catches
and logs any failure from `processPendingLookups()` rather than letting
one bad tick kill the schedule.

```ts
new Scheduler("*/5 * * * *"); // e.g. every 5 minutes
scheduler.start();
scheduler.stop();
```

## CLI

```
node src/main.ts --path <repo> --data-sources-cron "<cron expression>"
```

`--data-sources-cron` doesn't need `--path` — the queue is global (keyed
by package name, not tied to any one repo), so draining it can run on its
own schedule independently of any particular scan.
