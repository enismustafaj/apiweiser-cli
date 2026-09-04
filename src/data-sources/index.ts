import type { Dependency } from "../dependencies/types.ts";
import { db } from "../db/singleton.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { PendingChangelogLookupsRepository } from "./db/pending-changelog-lookups-repository.ts";
import { NpmRegistryLookup } from "./npm-registry-lookup.ts";

// npm doesn't publish an official rate limit for the public registry API.
// This is a conservative per-tick budget based on empirically getting
// rate-limited (429) after a few hundred rapid sequential requests.
// ponytail: fixed constant until there's a reason to tune it.
const BATCH_SIZE = 50;

export class DataSourcesModule {
  private readonly npmRegistryLookup = new NpmRegistryLookup();
  private readonly dataSourcesRepository = new DataSourcesRepository(db);
  private readonly pendingLookupsRepository = new PendingChangelogLookupsRepository(db);

  // Called by DependenciesModule.scan() for brand-new packages. Just queues
  // them - no network call here, so a scan never blocks on (or floods) the
  // npm registry. The actual lookups happen in processPendingLookups(), on
  // whatever cadence Scheduler is given.
  enqueueForLookup(dependencies: Dependency[]): void {
    this.pendingLookupsRepository.enqueue(dependencies);
  }

  // One scheduler tick: claims up to BATCH_SIZE pending lookups and
  // resolves each via NpmRegistryLookup. Removal from the queue happens
  // per-package, right after (not before, and not batched at the end
  // after) its outcome is durably recorded - a found URL is inserted into
  // data_sources *before* its pending row is removed, so a crash mid-batch
  // can't drop an already-dequeued package's URL. NpmRegistryLookup
  // returning null is a definitive answer - no repository data exists for
  // this package - so it's logged and removed from the queue right away,
  // not retried. Only a *thrown* error (network failure, 429, ...) is
  // transient, and leaves the entry queued for the next tick.
  async processPendingLookups(): Promise<void> {
    const batch = this.pendingLookupsRepository.takeBatch(BATCH_SIZE);

    for (const { pendingId, packageId, packageName } of batch) {
      try {
        const url = await this.npmRegistryLookup.findChangelogSource(packageName);
        if (url) {
          this.dataSourcesRepository.insert(new Map([[packageId, url]]));
        } else {
          console.log(`DataSourcesModule: no changelog source found for "${packageName}"`);
        }
        this.pendingLookupsRepository.remove(pendingId);
      } catch (err) {
        console.error(`DataSourcesModule: lookup failed for "${packageName}", will retry:`, err);
      }
    }
  }
}
