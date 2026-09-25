import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GitHubReleaseFetcher } from "../../src/data-sources/github-release-fetcher.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Only page 1 gets real data, matching a real repo with fewer releases
// than one page - same as GitHub itself returning an empty array past the
// last page, which is what stops fetchUntil's pagination loop.
function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async (url: string | URL) => {
    const page = new URL(url).searchParams.get("page");
    const pageBody = page === "1" || page === null ? body : [];
    return new Response(JSON.stringify(status === 200 ? pageBody : body), { status });
  }) as typeof fetch;
}

test("fetchRange returns releases strictly after from and up to and including to, oldest first", async () => {
  stubFetch(200, [
    { tag_name: "v3.0.0", body: "three" },
    { tag_name: "v2.0.0", body: "two" },
    { tag_name: "v1.5.0", body: "one point five" },
    { tag_name: "v1.0.0", body: "one" },
  ]);

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "2.0.0",
  );

  assert.deepEqual(result, [
    { tagName: "v1.5.0", body: "one point five" },
    { tagName: "v2.0.0", body: "two" },
  ]);
});

test("fetchRange defaults a null body to an empty string", async () => {
  stubFetch(200, [{ tag_name: "v2.0.0", body: null }]);

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "2.0.0",
  );

  assert.deepEqual(result, [{ tagName: "v2.0.0", body: "" }]);
});

test("fetchRange skips a tag that doesn't coerce to a semver version", async () => {
  stubFetch(200, [
    { tag_name: "not-a-version", body: "???" },
    { tag_name: "v1.5.0", body: "real one" },
  ]);

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "2.0.0",
  );

  assert.deepEqual(result, [{ tagName: "v1.5.0", body: "real one" }]);
});

test("fetchRange handles scoped/monorepo-style tags (e.g. package@1.2.3)", async () => {
  stubFetch(200, [{ tag_name: "styled-components@6.5.3", body: "notes" }]);

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "5.0.0",
    "7.0.0",
  );

  assert.deepEqual(result, [{ tagName: "styled-components@6.5.3", body: "notes" }]);
});

test("fetchRange returns an empty array when nothing falls in range", async () => {
  stubFetch(200, [{ tag_name: "v1.0.1", body: "patch" }]);

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "1.0.0",
  );

  assert.deepEqual(result, []);
});

test("fetchRange throws on a non-ok response", async () => {
  stubFetch(403, {});

  await assert.rejects(() =>
    new GitHubReleaseFetcher().fetchRange("https://api.github.com/x", "1.0.0", "2.0.0"),
  );
});

// Real bug, found running the full pipeline against a real repo
// (next.js): its releases endpoint's first page (default page size) can be
// a solid wall of newer `-canary.N` prereleases, burying the actual target
// range on a later page - without pagination, fetchRange silently came
// back empty for a real, in-range upgrade.
test("fetchRange finds a release buried on a later page behind newer releases", async () => {
  globalThis.fetch = (async (url: string | URL) => {
    const page = new URL(url).searchParams.get("page");
    const body =
      page === "1"
        ? [{ tag_name: "v3.0.0-canary.1", body: "canary noise" }]
        : [{ tag_name: "v1.5.0", body: "the real one" }];
    return new Response(JSON.stringify(page === "3" ? [] : body), { status: 200 });
  }) as typeof fetch;

  const result = await new GitHubReleaseFetcher().fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "2.0.0",
  );

  assert.deepEqual(result, [{ tagName: "v1.5.0", body: "the real one" }]);
});

test("fetchRange sends an Authorization header when constructed with a token", async () => {
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;

  await new GitHubReleaseFetcher("my-token").fetchRange(
    "https://api.github.com/x",
    "1.0.0",
    "2.0.0",
  );

  assert.equal(capturedHeaders?.get("Authorization"), "Bearer my-token");
});

test("fetchRange omits Authorization when constructed without a token", async () => {
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = (async (_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;

  await new GitHubReleaseFetcher().fetchRange("https://api.github.com/x", "1.0.0", "2.0.0");

  assert.equal(capturedHeaders?.has("Authorization"), false);
});
