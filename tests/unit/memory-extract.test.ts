import test from "node:test";
import assert from "node:assert/strict";

import { buildSessionCheckpointCandidate } from "../../src/memory/extract.js";

test("buildSessionCheckpointCandidate prioritizes focused files and ignores memory-write noise", () => {
  const baseTime = Date.now();
  const events = [
    {
      eventId: "evt-noise",
      eventType: "memory_save",
      payload: {
        title: "noise"
      },
      createdAt: baseTime - 1000
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      eventId: `evt-${index}`,
      eventType: index < 5 ? "decision" : "failure",
      payload: {
        filePath: "src/auth.ts",
        symbolId: "createSession",
        query: "auth token rotation"
      },
      createdAt: baseTime + index
    }))
  ];

  const checkpoint = buildSessionCheckpointCandidate(events, {
    repoId: "repo_auth",
    repoName: "auth-repo",
    sessionId: "session_auth"
  });

  assert.ok(checkpoint);
  assert.equal(checkpoint.room, "createSession".toLowerCase());
  assert.match(checkpoint.summary, /src\/auth\.ts/);
  assert.match(checkpoint.summary, /createSession|auth token rotation/);
  assert.match(checkpoint.detail, /src\/auth\.ts/);
  assert.doesNotMatch(checkpoint.detail, /noise/);
});
