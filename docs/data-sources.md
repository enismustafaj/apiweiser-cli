# Data sources

`src/data-sources/` — for packages the SBOM scan has never seen before,
asks an LLM where to fetch their release changelog from, and persists the
result.

```
src/data-sources/
  db/data-sources-repository.ts  class DataSourcesRepository(db)
  index.ts                       class DataSourcesModule(llmConfig)
```

The agent itself, `ChangelogSourceAgent`, lives in
`src/dependencies/agent/` (it was built before this module existed) —
`DataSourcesModule` owns an instance of it, constructed from the same
`LlmConfig` it's given. See [`docs/config.md`](./config.md) for where that
config comes from.

## Why only _new_ packages

`DependenciesModule.scan()` computes two different sets from the SBOM's
dependency list (see `PackagesRepository`, documented in
[`docs/database.md`](./database.md)):

- `findChangedOrNew` — new **or** version-bumped, drives whether `Scanner`
  re-scans a package's call sites.
- `findNew` — new only, no `packages` row at all before this scan. This is
  what `DataSourcesModule` acts on.

A package that's already known and just had a version bump doesn't need
its changelog source looked up again — the _source_ (its GitHub repo)
doesn't change between versions, only the version does. Re-running the
agent on every bump would be an LLM call per scan for no new information.

## `DataSourcesModule.recordChangelogSources(dependencies)`

Called by `DependenciesModule.scan()` with exactly that "new only" set,
**after** `PackagesRepository.upsert()` has run — every dependency passed
in is expected to already have `.id` set (see the `RETURNING id` note in
[`docs/database.md`](./database.md)). If one doesn't (shouldn't happen in
practice, given the call order), it's skipped with a logged error rather
than inserting a broken row.

For each dependency:

1. Calls `ChangelogSourceAgent.findChangelogSource(dependency)`.
2. On success, records `dependency.id -> url` in a map.
3. On failure (bad API key, network error, model refusal, rate limit —
   anything `ChangelogSourceAgent` throws), logs it via `console.error` and
   moves on. **One dependency failing never aborts the batch or the scan**
   — changelog-source lookup is a nice-to-have layered on top of the core
   scan, not something that should make `node src/main.ts --path X` fail
   because an LLM call timed out.

Once every dependency's been attempted, the accumulated map is handed to
`DataSourcesRepository.insert()` in a single call.

## `ChangelogSourceAgent.findChangelogSource(dependency)`

Uses the OpenAI SDK (`chat.completions.create`) with a structured-output
schema (`response_format: { type: "json_schema", ... }`) so the model's
answer is always `{ url: string }` — never prose to scrape. The prompt
asks specifically for a **GitHub** source: the package's releases page
(`https://github.com/<owner>/<repo>/releases`) or a raw `CHANGELOG.md` URL
from that repository.

Two failure modes are checked explicitly before trusting the response:

- `choice.finish_reason === "content_filter"` or `choice.message.refusal`
  set — the model (or a moderation layer) declined; thrown as an error
  rather than returned as a URL.
- `choice.message.content` empty — no answer to parse.

## `DataSourcesRepository.insert(sources)`

Takes `Map<packageId, url>` (not by name) and does a plain
`INSERT INTO data_sources (package_id, url) VALUES (?, ?)` per entry — see
[`docs/database.md`](./database.md) for why this one doesn't need the
by-name subquery `CallSitesRepository` uses.
