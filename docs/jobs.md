# Jobs

`src/jobs/` — the background work `scan` kicks off after scanning, and when
it runs.

Built on the command pattern: each piece of work is a `Job` object
(`{ name, run() }`), and one `Scheduler` decides _when_ to run a list of
them. The job doesn't know whether it's on a cron or running once - so
`scan` and `scan --once` run exactly the same jobs, in exactly the same
order.

## `Job`

```ts
interface Job {
  name: string; // used in failure logs
  run(): Promise<void>;
}
```

| job                  | file                      | runs                                                                                          |
| -------------------- | ------------------------- | --------------------------------------------------------------------------------------------- |
| `ChangelogLookupJob` | `changelog-lookup-job.ts` | `DataSourcesModule.processPendingLookups()` - see [`docs/data-sources.md`](./data-sources.md) |
| `SuggestionsJob`     | `suggestions-job.ts`      | `SuggestionsModule.generate(repoPath)` - see [`docs/suggestions.md`](./suggestions.md)        |

Each takes its module (and, for suggestions, the repo path) in its
constructor, so `main.ts` does all the wiring and a job is just "call this
one method". A new kind of background work is one more small class.

## `Scheduler`

`new Scheduler(cronExpression, jobs)`:

- **`runAll()`** runs every job **in list order, one at a time** (each
  awaited before the next starts). Order matters: `SuggestionsJob`
  summarizes changelogs from sources `ChangelogLookupJob` just found. A job
  that throws is caught and logged as `<name> job failed:` - the jobs after
  it still run, and `runAll()` itself never rejects.
- **`start()`** registers `runAll()` on the cron with `node-cron`'s
  `createTask` and starts it. A failed tick is logged by `runAll()` above,
  so it never kills the schedule.

There's no `stop()` - nothing ever stops the schedule except the process
exiting.

Before this, each job had its own near-identical scheduler class
(`data-sources/changelog-lookup-scheduler.ts`,
`suggestions/suggestions-scheduler.ts`), both on the same midnight cron.
Nothing guaranteed which of the two fired first.

## CLI

`main.ts` builds one `Scheduler` after the scan, with a fixed once-a-day
cron (`"0 0 * * *"`) and `[ChangelogLookupJob, SuggestionsJob]`:

- `scan` (default) calls `start()` and the process stays up.
- `scan --once` awaits `runAll()` instead and returns. `start()` was never
  called, so no cron timer holds the event loop and the process exits by
  itself.
