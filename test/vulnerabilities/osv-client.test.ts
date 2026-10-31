import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OsvClient } from "../../src/vulnerabilities/osv-client.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// The shape OSV really returns: an advisory fixed separately on two major
// lines, plus an unrelated package's range that must be ignored.
const ADVISORY = {
  id: "GHSA-1111",
  summary: "Prototype pollution",
  database_specific: { severity: "HIGH" },
  affected: [
    {
      package: { name: "express", ecosystem: "npm" },
      ranges: [
        { type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.3" }] },
        { type: "SEMVER", events: [{ introduced: "5.0.0" }, { fixed: "5.0.1" }] },
      ],
    },
    {
      package: { name: "express-other", ecosystem: "npm" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.2" }] }],
    },
  ],
};

test("returns each package's advisories with the nearest fixed version", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (String(url).endsWith("/querybatch")) {
      const { queries } = JSON.parse(String(init!.body));
      assert.deepEqual(queries, [
        { package: { name: "express", ecosystem: "npm" }, version: "4.17.1" },
        { package: { name: "zod", ecosystem: "npm" }, version: "3.23.8" },
      ]);
      return Response.json({ results: [{ vulns: [{ id: "GHSA-1111" }] }, {}] });
    }
    return Response.json(ADVISORY);
  }) as typeof fetch;

  const found = await new OsvClient().findVulnerabilities([
    { name: "express", version: "4.17.1" },
    { name: "zod", version: "3.23.8" },
  ]);

  assert.deepEqual(Object.fromEntries(found), {
    express: [
      { id: "GHSA-1111", summary: "Prototype pollution", severity: "HIGH", fixedIn: "4.17.3" },
    ],
    zod: [],
  });
  assert.equal(requests.length, 2, "one batch query, then one fetch per distinct advisory");
});

test("fixedIn is null when no fix is above the installed version", async () => {
  globalThis.fetch = (async (url: string | URL) =>
    String(url).endsWith("/querybatch")
      ? Response.json({ results: [{ vulns: [{ id: "GHSA-1111" }] }] })
      : Response.json(ADVISORY)) as typeof fetch;

  const found = await new OsvClient().findVulnerabilities([{ name: "express", version: "5.0.1" }]);

  assert.equal(found.get("express")![0]!.fixedIn, null);
});

test("throws when OSV answers with an error", async () => {
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;

  await assert.rejects(
    new OsvClient().findVulnerabilities([{ name: "express", version: "4.17.1" }]),
    /OSV returned 503/,
  );
});
