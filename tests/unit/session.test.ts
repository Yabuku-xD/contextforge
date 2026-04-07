import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createContextForge } from "../../src/contextforge.js";
import { recordSessionEvent, listSessionEvents } from "../../src/session/events.js";
import { purgeOldSessionEvents } from "../../src/session/retention.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");
const memoryRoot = path.join(os.tmpdir(), "contextforge-memory-tests", "session");
fs.mkdirSync(memoryRoot, { recursive: true });

test("session events redact secrets and can be purged", () => {
  const forge = createContextForge(sampleRepo, { sessionId: "session_redact", memoryRoot });
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

test("session events redact nested secret strings too", () => {
  const forge = createContextForge(sampleRepo, { sessionId: "session_redact_nested", memoryRoot });
  try {
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "decision",
      payload: {
        nested: {
          token: "sk-abcdefghijklmnopqrstuvwxyz",
          auth: {
            password: "password='secret123'"
          }
        }
      }
    });

    const event = listSessionEvents(forge.db, forge.sessionId, forge.repoId)[0];
    assert.equal(event.payload.nested.token, "[REDACTED]");
    assert.equal(event.payload.nested.auth.password, "[REDACTED]");
  } finally {
    forge.close();
  }
});

test("purge clears session scoped compression stats", async () => {
  const forge = createContextForge(sampleRepo, { sessionId: "session_purge_stats", memoryRoot });
  try {
    await forge.processArtifact("2026-01-01 INFO retry scheduled\n2026-01-01 INFO retry scheduled", {
      filePath: "checkout.log"
    });
    forge.recordToolReceipt({
      toolName: "forge_walk",
      rawSize: 20_000,
      deliveredSize: 1_000
    });

    assert.equal(forge.stats().compression.count, 1);
    assert.equal(forge.stats().deliverySavings.count, 1);
    forge.purge();
    assert.equal(forge.stats().compression.count, 0);
    assert.equal(forge.stats().deliverySavings.count, 0);
  } finally {
    forge.close();
  }
});
