// A real local HTTP server that never responds, not a mock - proving the
// abort actually fires is the whole point (see http.ts's comment for why
// this exists: a real hang, reproduced once, sat open indefinitely
// without one).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { fetchWithTimeout } from "../src/http.ts";

let server: Server;
let baseUrl: string;

before(async () => {
  // Accepts the connection but never writes a response - the exact shape
  // of the real hang this is guarding against.
  server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address && typeof address === "object") {
    baseUrl = `http://127.0.0.1:${address.port}/`;
  }
});

after(() => {
  server.close();
});

test("fetchWithTimeout aborts a request that never responds", async () => {
  await assert.rejects(
    () => fetchWithTimeout(baseUrl, undefined, 50),
    (err: unknown) => err instanceof Error && err.name === "TimeoutError",
  );
});

test("fetchWithTimeout resolves normally for a fast response", async () => {
  const fastServer = createServer((_req, res) => res.end("ok"));
  await new Promise<void>((resolve) => fastServer.listen(0, resolve));
  const address = fastServer.address();
  const fastUrl = address && typeof address === "object" ? `http://127.0.0.1:${address.port}/` : "";

  const response = await fetchWithTimeout(fastUrl, undefined, 5000);

  assert.equal(response.status, 200);
  fastServer.close();
});
