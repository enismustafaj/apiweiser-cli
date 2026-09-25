import type { Dependency } from "../dependencies/types.ts";
import { db } from "../db/singleton.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { PendingChangelogLookupsRepository } from "./db/pending-changelog-lookups-repository.ts";
import { NpmRegistryLookup } from "./npm-registry-lookup.ts";

const BATCH_SIZE = 50;

export class DataSourcesModule {
  private readonly npmRegistryLookup = new NpmRegistryLookup();
  private readonly dataSourcesRepository = new DataSourcesRepository(db);
  private readonly pendingLookupsRepository = new PendingChangelogLookupsRepository(db);

  enqueueForLookup(dependencies: Dependency[]): void {
    this.pendingLookupsRepository.enqueue(dependencies);
  }

  // Removal happens per-package, right after its outcome is durably
  // recorded (a found URL is inserted before its pending row is removed),
  // so a crash mid-batch can't drop an already-dequeued package's URL. A
  // definitive `null` result is removed and not retried; only a *thrown*
  // error leaves the entry queued for the next tick.
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
