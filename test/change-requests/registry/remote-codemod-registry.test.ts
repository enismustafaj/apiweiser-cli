import assert from "node:assert/strict";
import { test } from "node:test";
import { RemoteCodemodRegistry } from "../../../src/change-requests/registry/remote-codemod-registry.ts";

// publish() shells out to the real `codemod` CLI, which hits a real,
// authenticated remote service - not covered by an automated test beyond
// these guards, same reasoning as RenovateTool (see docs/suggestions.md)
// and DependencyBumper.bump (see docs/github.md).

test('publish throws when mode isn\'t "remote"', async () => {
  await assert.rejects(
    () =>
      new RemoteCodemodRegistry({ mode: "local", scope: "my-scope", apiKey: "key" }).publish(
        "/tmp/whatever",
      ),
    /needs codemodRegistry\.mode: "remote"/,
  );
});

test("publish throws when scope isn't configured", async () => {
  await assert.rejects(
    () =>
      new RemoteCodemodRegistry({ mode: "remote", scope: "", apiKey: "key" }).publish(
        "/tmp/whatever",
      ),
    /needs codemodRegistry\.mode: "remote"/,
  );
});

test("publish throws when apiKey isn't configured", async () => {
  await assert.rejects(
    () => new RemoteCodemodRegistry({ mode: "remote", scope: "my-scope" }).publish("/tmp/whatever"),
    /needs codemodRegistry\.mode: "remote"/,
  );
});

test("publish throws when no config is provided at all", async () => {
  await assert.rejects(
    () => new RemoteCodemodRegistry().publish("/tmp/whatever"),
    /needs codemodRegistry\.mode: "remote"/,
  );
});
