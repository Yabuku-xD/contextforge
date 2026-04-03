import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createContextForge } from "../../src/contextforge.js";
import { recordSessionEvent, listSessionEvents } from "../../src/session/events.js";
import { purgeOldSessionEvents } from "../../src/session/retention.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("session events redact secrets and can be purged", () => {
  const forge = createContextForge(sampleRepo, { sessionId: "session_redact" });
  try {
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "decision",
      payload: { note: "use password='secret123' and sk-abcdefghijklmnopqrstuvwxyz" }
    });

    const event = listSessionEvents(forge.db, forge.sessionId, forge.repoId)[0];
    assert.ok(event.payload.note.includes("[REDACTED]"));

    purgeOldSessionEvents(forge.db, 0);
    assert.equal(listSessionEvents(forge.db, forge.sessionId, forge.repoId).length, 0);
  } finally {
    forge.close();
  }
});

test("purge clears session scoped compression stats", async () => {
  const forge = createContextForge(sampleRepo, { sessionId: "session_purge_stats" });
  try {
    await forge.processArtifact("2026-01-01 INFO retry scheduled\n2026-01-01 INFO retry scheduled", {
      filePath: "checkout.log"
    });

    assert.equal(forge.stats().compression.count, 1);
    forge.purge();
    assert.equal(forge.stats().compression.count, 0);
  } finally {
    forge.close();
  }
});
