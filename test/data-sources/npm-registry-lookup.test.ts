import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { NpmRegistryLookup } from "../../src/data-sources/npm-registry-lookup.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("findChangelogSource returns null for a 404 (package not found)", async () => {
  stubFetch(404, {});

  const result = await new NpmRegistryLookup().findChangelogSource("does-not-exist");

  assert.equal(result, null);
});

test("findChangelogSource returns null when the manifest has no repository field", async () => {
  stubFetch(200, {});

  const result = await new NpmRegistryLookup().findChangelogSource("no-repo-field");

  assert.equal(result, null);
});

test("findChangelogSource throws on a transient failure (429), not null", async () => {
  stubFetch(429, {});

  await assert.rejects(() => new NpmRegistryLookup().findChangelogSource("rate-limited"));
});

test("findChangelogSource resolves a plain github.com https url", async () => {
  stubFetch(200, { repository: { url: "https://github.com/sindresorhus/got.git" } });

  const result = await new NpmRegistryLookup().findChangelogSource("got");

  assert.equal(result, "https://api.github.com/repos/sindresorhus/got/releases");
});

test("findChangelogSource resolves a git+ssh url", async () => {
  stubFetch(200, { repository: { url: "git+ssh://git@github.com/owner/repo.git" } });

  const result = await new NpmRegistryLookup().findChangelogSource("pkg");

  assert.equal(result, "https://api.github.com/repos/owner/repo/releases");
});

test("findChangelogSource resolves a git@github.com: scp-style url", async () => {
  stubFetch(200, { repository: { url: "git@github.com:owner/repo.git" } });

  const result = await new NpmRegistryLookup().findChangelogSource("pkg");

  assert.equal(result, "https://api.github.com/repos/owner/repo/releases");
});

test("findChangelogSource resolves a github: shorthand url", async () => {
  stubFetch(200, { repository: { url: "github:owner/repo" } });

  const result = await new NpmRegistryLookup().findChangelogSource("pkg");

  assert.equal(result, "https://api.github.com/repos/owner/repo/releases");
});

test("findChangelogSource resolves a bare owner/repo shorthand", async () => {
  stubFetch(200, { repository: "owner/repo" });

  const result = await new NpmRegistryLookup().findChangelogSource("pkg");

  assert.equal(result, "https://api.github.com/repos/owner/repo/releases");
});

test("findChangelogSource returns null for a non-GitHub repository url", async () => {
  stubFetch(200, { repository: { url: "https://gitlab.com/owner/repo.git" } });

  const result = await new NpmRegistryLookup().findChangelogSource("pkg");

  assert.equal(result, null);
});
