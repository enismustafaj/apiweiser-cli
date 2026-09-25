# Data sources

`src/data-sources/` — for packages the SBOM scan has never seen before,
derives where to fetch their release changelog from, using npm registry
metadata only (no LLM). Lookups are queued and drained in rate-limit-sized
batches on a schedule, not done inline during a scan.

This module covers two related but independent pieces: **finding** where a
package's changelog lives (`NpmRegistryLookup` → `data_sources`, no LLM),
and the tools `SuggestionsModule` uses to **summarize** what actually
changed for a specific proposed upgrade (`GitHubReleaseFetcher` +
`ChangelogSummarizerAgent` → an LLM, invoked inline per suggestion, not as
a separate batch job). The sections below cover the first; see
[§ Changelog summarization](#changelog-summarization) for the second.

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

**A trailing `#<subdirectory>`** (npm's shorthand for `repository.directory`,
for a package published from a subfolder of a larger repo - found via a
real one, `ext`, whose `repository.url` is
`git+https://github.com/medikoo/es5-ext.git#ext`) gets stripped before the
`.git` suffix is stripped, not after - `.git$` doesn't match
`.git#ext`, so doing it in the other order left `ext` swept into the repo
name (`medikoo/es5-ext.git#ext`), a URL that always 404s.

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

`enqueueForLookup(dependencies)` is called by `DependenciesModule.scan()`
with the "new only" set, after `PackagesRepository.upsert()` has run (so
each `Dependency.id` is set — see the `RETURNING id` note in
[`docs/database.md`](./database.md)). Pure insert via
`PendingChangelogLookupsRepository`, no network call, no `await` needed.

`processPendingLookups()` runs one scheduler tick:

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
one bad tick kill the schedule. Constructed with a cron expression (e.g.
every 5 minutes), then `.start()`/`.stop()`.

## CLI

Not behind a flag - `main.ts` always constructs and starts this
`Scheduler` (after the required `--path` scan finishes), with a fixed
once-a-day cron (`"0 0 * * *"`; the class itself still takes any
expression, see above). The queue itself is global (keyed by package name,
not tied to any one repo) - `--path` is required by the CLI regardless,
but draining this particular queue doesn't depend on what was scanned.

## Changelog summarization

There's no longer a separate daily "is this breaking?" batch job. That
design (walk every known package once a day, classify its **latest**
release in isolation, gate change requests on the result) was tried and
measurably failed on two real repos: it only ever looks at the single
newest release's own notes, so a multi-major jump (`react 16→19`,
`next 10→16`, `styled-components 5→6`) came back "not breaking" every
time, because the actual breaking change happened in an intermediate
major whose notes the latest release doesn't recap. Replaced with
`ChangelogSummarizer`, called inline by `SuggestionsModule` (see
[`docs/suggestions.md`](./suggestions.md)) once per real suggestion,
targeting the exact version range Renovate proposed - not a batch job, no
`release_analysis_runs`/`release_analysis_results` tables, no separate
scheduler.

### `GitHubReleaseFetcher.fetchRange(releasesUrl, fromVersion, toVersion)`

`GET` the releases API endpoint a `data_sources` row already points to,
and return every release strictly after `fromVersion` and up to and
including `toVersion`, oldest first. This is the actual fix: a package's
single latest release can look harmless while an earlier major in the
same range genuinely broke something, so the full range gets concatenated
and summarized together, not just whatever's currently newest.

Tags aren't always plain `vX.Y.Z` - real ones seen in practice include
scoped/monorepo-style tags like `styled-components@6.5.3` and
`spectacle@10.2.3`. `semver.coerce()` extracts the first `x.y.z` pattern
found in each tag for comparison; a tag that doesn't coerce to anything is
silently skipped rather than treated as an error.

**GitHub's own rate limit is a real constraint here**: unauthenticated
requests are capped at 60/hour. `GitHubReleaseFetcher` takes an optional
token (`ChangelogSummarizer` passes `config.github.token` through), sent
as `Authorization: Bearer <token>` when present, which raises the limit to
5,000/hour. Still optional - constructing it without a `GithubConfig`
falls back to unauthenticated, so this class doesn't hard-require a token
just to run in isolation.

### `ChangelogSummarizerAgent.summarize(releaseNotes)`

Lives in `src/data-sources/agent/`. Plain prose out, not structured
JSON - there's no boolean decision to extract anymore, just a summary for
the coding agent to read (see `ChangeRequestInput.summary` in
[`docs/change-requests.md`](./change-requests.md)). Dropping the
`json_schema` `response_format` the old classifier used is also more
portable, not just simpler: not every model/provider honors it reliably
(verified directly - a free OpenRouter model just ignored the schema and
returned prose instead of JSON). Same refusal/content-filter/empty-response
checks as before.

### `ChangelogSummarizer.summarize(packageName, fromVersion, toVersion)`

Orchestrates the above for one Renovate suggestion:

1. `DataSourcesRepository.findUrl(packageName)` - `null` (no known
   changelog source) short-circuits to `null`, nothing to summarize.
2. `GitHubReleaseFetcher.fetchRange(...)` for the exact
   `fromVersion`→`toVersion` span, concatenated into one document (each
   release's body under a `## <tag>` heading). An empty result (no
   releases actually fall in range) also short-circuits to `null`.
3. Capped at `MAX_COMBINED_LENGTH` (60,000 characters) before
   summarizing - ponytail: a flat cap, not per-release trimming, since a
   fast-moving package could otherwise have hundreds of releases in range,
   and a truncated-but-complete prefix is still more useful to the model
   than nothing.
4. `ChangelogSummarizerAgent.summarize(...)` on the (possibly truncated)
   combined text.

### `DataSourcesRepository.findUrl(packageName)`

By package name, not id - a changelog source is a property of the package
itself, not of whichever repo's scan happened to discover it first (same
reasoning as `PackagesRepository.findNew`, see
[`docs/database.md`](./database.md)).

### A real hang, and the fix: `fetchWithTimeout`

Found by reproducing it in isolation, not guessed at: a real
`ChangelogSummarizerAgent.summarize()` call once sat open with zero
response and zero CPU activity indefinitely, after several earlier calls
in the same run had already been getting progressively slower (10s, 17s,
26s, 29s). `fetch()` has no default timeout, and the OpenAI SDK's own
default is 10 minutes - both far too long for a pipeline meant to process
a repo's suggestions in one sitting. Every direct `fetch()` call in this
codebase (`GitHubReleaseFetcher`, `NpmRegistryLookup`,
`PullRequestService` - see [`docs/github.md`](./github.md)) now goes
through `src/http.ts`'s `fetchWithTimeout` (60s, `AbortSignal.timeout`),
and `ChangelogSummarizerAgent`'s `OpenAI` client is constructed with the
same `timeout` value - a non-responding endpoint now fails like any other
error (logged, skipped) instead of blocking the whole run forever.
