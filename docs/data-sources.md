# Data sources

`src/data-sources/` — for packages the SBOM scan has never seen before,
derives where to fetch their release changelog from, using npm registry
metadata only (no LLM). Lookups are queued and drained in rate-limit-sized
batches on a schedule, not done inline during a scan.

```
src/data-sources/
  types.ts                                shared types (see below, one per class)
  npm-registry-lookup.ts                  class NpmRegistryLookup
  github-release-fetcher.ts               class GitHubReleaseFetcher
  agent/breaking-change-classifier.ts     class BreakingChangeClassifierAgent
  db/pending-changelog-lookups-repository.ts  class PendingChangelogLookupsRepository(db)
  db/data-sources-repository.ts           class DataSourcesRepository(db)
  db/release-analysis-repository.ts        class ReleaseAnalysisRepository(db)
  index.ts                                class DataSourcesModule
  changelog-lookup-scheduler.ts           class Scheduler(cronExpr) - drains the lookup queue
  release-analysis.ts                     class ReleaseAnalysisModule(llmConfig)
  release-analysis-scheduler.ts           class Scheduler(cronExpr, llmConfig) - runs release analysis
```

This module covers two related but independent pipelines: **finding**
where a package's changelog lives (`NpmRegistryLookup` → `data_sources`,
no LLM), and **classifying** what its latest release actually says
(`GitHubReleaseFetcher` + `BreakingChangeClassifierAgent` → an LLM). The
sections below cover the first pipeline; see
[§ Release analysis](#release-analysis) for the second.

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
   - **Resolves to a URL** → written to `data_sources` immediately, _then_
     the entry is removed from the queue. Insert-before-remove, per
     package, with no `await` in between — not a batch insert after the
     whole tick's loop finishes. That ordering used to be reversed
     (removal happened immediately per item, but every found URL was
     collected into a `Map` and only written to `data_sources` in one
     insert _after_ the loop finished) — if the process died partway
     through a tick, an already-dequeued package's URL could be lost
     entirely, never written anywhere. Insert-then-remove, per package,
     closes that window.
   - **Resolves to `null`** (no repository data — a definitive answer) →
     logged via `console.log`, and the entry is **still removed** from the
     queue. There's nothing to retry; leaving it queued would just burn
     one of every future tick's budget on a package that will never
     resolve.
   - **Throws** (network failure, `429`, ...) → logged via
     `console.error`, entry **stays queued** for the next tick.

## `DataSourcesRepository.insert(sources)`

`Map<packageId, url>` → `INSERT INTO data_sources (package_id, url) VALUES (?, ?)`
per entry — no subquery, since callers already have the id on hand. See
[`docs/database.md`](./database.md) for why this one doesn't need the
by-name subquery `CallSitesRepository` uses.

## `Scheduler` (changelog-lookup-scheduler.ts)

Same shape as `suggestions/suggestions-scheduler.ts`: wraps `node-cron`'s `createTask`
so the task exists but sits idle until `.start()`, and each tick catches
and logs any failure from `processPendingLookups()` rather than letting
one bad tick kill the schedule.

```ts
new Scheduler("*/5 * * * *"); // e.g. every 5 minutes
scheduler.start();
scheduler.stop();
```

## CLI

Not behind a flag - `main.ts` always constructs and starts this
`Scheduler` (after the required `--path` scan finishes), with a fixed
once-a-day cron (`"0 0 * * *"`; the class itself still takes any
expression, see above). The queue itself is global (keyed by package name,
not tied to any one repo) - `--path` is required by the CLI regardless,
but draining this particular queue doesn't depend on what was scanned.

## Release analysis

A second, independent pipeline: once a day, walk every known
`data_sources` entry, fetch its package's **latest** GitHub release, and
classify whether that release contains breaking changes.

### `GitHubReleaseFetcher.fetchLatest(releasesUrl)`

`GET` the releases API endpoint a `data_sources` row already points to.
GitHub returns releases newest-first, so the latest release is just
`releases[0]`. Returns `{ tagName, body }`, or `null` if the repo has no
releases published at all (not an error — plenty of packages tag versions
without ever creating a GitHub Release).

**GitHub's own rate limit is a real constraint here, unaddressed for
now**: unauthenticated requests are capped at 60/hour. A run with more
than ~60 data sources will start failing (thrown, logged, skipped —
`ReleaseAnalysisModule` doesn't crash) partway through, even with the
pacing delay below, since that delay is sized for the _model's_ rate
limit, not GitHub's. A GitHub token would raise this to 5,000/hour; not
wired in yet — ask if you want it added (`Authorization: Bearer <token>`
on the fetch, likely via the same config file `ConfigLoader` already
reads).

### `BreakingChangeClassifierAgent.classify(releaseNotes)`

Lives in `src/data-sources/agent/` (this module owns it, unlike
`NpmRegistryLookup`'s pipeline, which has no LLM at all). Same shape as
the removed `ChangelogSourceAgent`: OpenAI SDK, `chat.completions.create`
with a `json_schema` `response_format` so the answer is always
`{ isBreaking: boolean, summary: string }` — never prose to parse. Checks
`finish_reason === "content_filter"` / `message.refusal` before trusting
the response, same as before.

### `release_analysis_runs` / `release_analysis_results`

See [`docs/database.md`](./database.md) for the column lists.
`ReleaseAnalysisRepository` covers both tables:
`.startRun()` inserts a `status: 'running'` row (`RETURNING id`, so the
caller doesn't need a second query) and `.finishRun(runId, status)` sets
`status` + `ended_at` once the run is done. `.insertResult()` writes one
row per package actually classified, tied to that run via `run_id`.

### `ReleaseAnalysisModule.run()`

1. Starts a run (`ReleaseAnalysisRepository.startRun()`).
2. For every `data_sources` entry (`DataSourcesRepository.listAll()`):
   fetch its latest release; if there's no release, or the release body
   is empty, skip it (nothing to classify); otherwise classify the body
   and insert a result. One package failing (no releases, GitHub rate
   limit, model refusal, ...) is logged and skipped — it doesn't abort the
   run, matching the resilience pattern used everywhere else in this
   module.
3. Between every package (whether it succeeded, was skipped, or failed),
   waits `DELAY_BETWEEN_PACKAGES_MS` (1 second) before continuing — **this
   is the "don't hit the model's rate limit" mechanism**. Unlike the
   lookup queue's `BATCH_SIZE` (which caps how much of the queue one tick
   touches, deliberately leaving the rest for later ticks), this pipeline
   is meant to get through _every_ data source each run, just paced out
   rather than fired all at once.
4. Marks the run `'completed'` when the loop finishes, or `'failed'` if
   something outside the per-package try/catch throws (a bug, not a
   per-package failure) — either way, the run is never left stuck at
   `'running'` forever.

### `Scheduler` (release-analysis-scheduler.ts)

Same shape as the other two schedulers in this CLI, but also takes an
`LlmConfig` (to construct `ReleaseAnalysisModule`'s classifier):

```ts
new Scheduler("0 0 * * *", llmConfig); // once a day at midnight - the intended cadence
scheduler.start();
scheduler.stop();
```

The cron expression is a constructor argument, not hardcoded inside the
class - same as the other schedulers. `main.ts` always passes the fixed
daily expression, though; it's not behind a CLI flag (see below).

### CLI

Not behind a flag - `main.ts` always constructs and starts this
`Scheduler` too, alongside the changelog-lookup one. `data_sources` itself
is global (not tied to what `--path` scanned), same reasoning as the
lookup queue - though `--path` is still required by the CLI regardless.
**Does** need a valid `~/.apiweiser-cli/config.json` (see
[`docs/config.md`](./config.md)) — since this scheduler is always on, so
is that requirement: every invocation of the CLI needs a filled-in config.
