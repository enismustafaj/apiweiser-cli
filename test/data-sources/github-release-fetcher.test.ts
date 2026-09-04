import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GitHubReleaseFetcher } from "../../src/data-sources/github-release-fetcher.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("fetchLatest returns the newest release (releases[0])", async () => {
  stubFetch(200, [
    { tag_name: "v2.0.0", body: "breaking stuff" },
    { tag_name: "v1.0.0", body: "old stuff" },
  ]);

  const result = await new GitHubReleaseFetcher().fetchLatest("https://api.github.com/x");

  assert.deepEqual(result, { tagName: "v2.0.0", body: "breaking stuff" });
});

test("fetchLatest defaults a null body to an empty string", async () => {
  stubFetch(200, [{ tag_name: "v1.0.0", body: null }]);

  const result = await new GitHubReleaseFetcher().fetchLatest("https://api.github.com/x");

  assert.deepEqual(result, { tagName: "v1.0.0", body: "" });
});

test("fetchLatest returns null when the repo has no releases", async () => {
  stubFetch(200, []);

  const result = await new GitHubReleaseFetcher().fetchLatest("https://api.github.com/x");

  assert.equal(result, null);
});

test("fetchLatest throws on a non-ok response", async () => {
  stubFetch(403, {});

  await assert.rejects(() => new GitHubReleaseFetcher().fetchLatest("https://api.github.com/x"));
});
