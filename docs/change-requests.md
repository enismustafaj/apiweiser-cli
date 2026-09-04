# Change requests

`src/change-requests/` — scaffolding only, implementation TBD. Turns a
breaking package update (surfaced by
[`docs/suggestions.md`](./suggestions.md), which classified it via
[`docs/data-sources.md`](./data-sources.md) § Release analysis) into a
change request.

```
src/change-requests/
  types.ts    ChangeRequestInput
  index.ts    class ChangeRequestsModule
```

## `ChangeRequestInput`

| field         | type         | notes                                        |
| ------------- | ------------ | -------------------------------------------- |
| `packageName` | `string`     |                                              |
| `version`     | `string`     | current version, before the update           |
| `newVersion`  | `string`     | Renovate's proposed version                  |
| `callSites`   | `CallSite[]` | from `CallSitesRepository.findForDependency` |
| `isBreaking`  | `boolean`    | from `release_analysis_results.is_breaking`  |
| `summary`     | `string`     | from `release_analysis_results.summary`      |

## `ChangeRequestsModule.create(input)`

Called by `SuggestionsModule` (see [`docs/suggestions.md`](./suggestions.md)
§ Raising change requests) whenever a proposed update's new version was
already classified as breaking. Currently `throws new Error("not
implemented")` — the caller wraps it in try/catch and logs, so this doesn't
crash `SuggestionsModule.generate()`.
