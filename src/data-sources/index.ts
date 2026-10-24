import { setTimeout as sleep } from "node:timers/promises";
import type { Dependency } from "../dependencies/types.ts";
import { db } from "../db/singleton.ts";
import { logger } from "../logger.ts";
import { DataSourcesRepository } from "./db/data-sources-repository.ts";
import { PendingChangelogLookupsRepository } from "./db/pending-changelog-lookups-repository.ts";
import { NpmRegistryLookup } from "./npm-registry-lookup.ts";

// The npm registry allows 50 requests per second. One request per package,
// sequential, so a minimum gap per lookup keeps us under it.
const MIN_REQUEST_GAP_MS = 1000 / 50;

const log = logger("data-sources");

export class DataSourcesModule {
  private readonly npmRegistryLookup = new NpmRegistryLookup();
  private readonly dataSourcesRepository = new DataSourcesRepository(db);
  private readonly pendingLookupsRepository = new PendingChangelogLookupsRepository(db);

  enqueueForLookup(dependencies: Dependency[]): void {
    this.pendingLookupsRepository.enqueue(dependencies);
  }

  // Removal happens per-package, right after its outcome is durably
  // recorded (a found URL is inserted before its pending row is removed),
  // so a crash mid-run can't drop an already-dequeued package's URL. A
  // definitive `null` result is removed and not retried; only a *thrown*
  // error leaves the entry queued for the next run.
  async processPendingLookups(): Promise<void> {
    const batch = this.pendingLookupsRepository.takeBatch();
    log.info(`Looking up changelog sources for ${batch.length} packages`);

    for (const { pendingId, packageId, packageName } of batch) {
      try {
        const url = await this.npmRegistryLookup.findChangelogSource(packageName);
        if (url) {
          this.dataSourcesRepository.insert(new Map([[packageId, url]]));
        } else {
          log.debug(`No changelog source found for "${packageName}"`);
        }
        this.pendingLookupsRepository.remove(pendingId);
      } catch (err) {
        log.warn(`Lookup failed for "${packageName}", will retry:`, err);
      }
      await sleep(MIN_REQUEST_GAP_MS);
    }
  }
}
