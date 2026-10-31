import semver from "semver";
import { fetchWithTimeout } from "../http.ts";
import type { OsvAdvisory, OsvBatchResponse, PackageVersion, Vulnerability } from "./types.ts";

const OSV_API = "https://api.osv.dev/v1";

// Known advisories from OSV.dev - no token needed. The batch endpoint only
// returns advisory ids, so each distinct advisory is then fetched once for
// its summary, severity and fixed versions.
// ponytail: querybatch pages past 1000 advisories per package; no npm
// package comes close, so the next-page token is ignored.
export class OsvClient {
  async findVulnerabilities(packages: PackageVersion[]): Promise<Map<string, Vulnerability[]>> {
    const found = new Map<string, Vulnerability[]>();
    if (packages.length === 0) return found;

    const batch = await this.post<OsvBatchResponse>("/querybatch", {
      queries: packages.map((pkg) => ({
        package: { name: pkg.name, ecosystem: "npm" },
        version: pkg.version,
      })),
    });
    const ids = batch.results.map((result) => (result.vulns ?? []).map((vuln) => vuln.id));

    const advisories = new Map<string, OsvAdvisory>();
    await Promise.all(
      [...new Set(ids.flat())].map(async (id) => {
        advisories.set(id, await this.get<OsvAdvisory>(`/vulns/${encodeURIComponent(id)}`));
      }),
    );

    packages.forEach((pkg, i) => {
      found.set(
        pkg.name,
        ids[i]!.map((id) => this.toVulnerability(advisories.get(id)!, pkg)),
      );
    });
    return found;
  }

  private toVulnerability(advisory: OsvAdvisory, pkg: PackageVersion): Vulnerability {
    return {
      id: advisory.id,
      summary: advisory.summary ?? null,
      severity: advisory.database_specific?.severity ?? null,
      fixedIn: this.fixedIn(advisory, pkg),
    };
  }

  // The lowest `fixed` event above the installed version, across this
  // package's ranges - an advisory can be fixed separately per major line
  // (e.g. 4.17.3 and 5.0.1), and the nearest fix is the useful one.
  private fixedIn(advisory: OsvAdvisory, pkg: PackageVersion): string | null {
    const fixes = (advisory.affected ?? [])
      .filter((entry) => entry.package?.name === pkg.name && entry.package.ecosystem === "npm")
      .flatMap((entry) => entry.ranges ?? [])
      .flatMap((range) => range.events.map((event) => event.fixed))
      .filter((fixed): fixed is string => !!fixed && !!semver.valid(fixed))
      .filter((fixed) => !semver.valid(pkg.version) || semver.gt(fixed, pkg.version))
      .sort(semver.compare);
    return fixes[0] ?? null;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.parse<T>(
      await fetchWithTimeout(`${OSV_API}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  private async get<T>(path: string): Promise<T> {
    return this.parse<T>(await fetchWithTimeout(`${OSV_API}${path}`));
  }

  private async parse<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`OSV returned ${response.status} for ${response.url}`);
    return (await response.json()) as T;
  }
}
