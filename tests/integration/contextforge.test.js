import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createContextForge } from "../../src/contextforge.js";
import { recordSessionEvent } from "../../src/session/events.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");
const repoRoot = path.resolve(".");

test("Phase 1 can index, search, analyze impact, and resume", async () => {
  const forge = createContextForge(sampleRepo, { sessionId: `test_session_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.filesIndexed >= 3);
    assert.ok(indexSummary.symbolsIndexed >= 5);
    const reusedSummary = forge.indexRepository();
    assert.equal(reusedSummary.reusedIndex, true);

    const searchResults = forge.search("checkout timeout", { limit: 5 });
    assert.ok(searchResults.some((result) => result.label.includes("checkout")));

    const impactResults = forge.impact("shouldRetry");
    assert.ok(impactResults.some((result) => result.canonicalName.includes("createCheckout")));

    const startup = forge.startup("hi");
    assert.equal(startup.task.label, "trivial");
    assert.equal(startup.pages.length, 1);

    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "failure",
      payload: { filePath: "src/checkout.ts", symbolId: "createCheckout", message: "timeout" }
    });

    const resume = forge.resume();
    assert.ok(resume.summary.includes("failure"));

    const why = forge.why("checkout timeout");
    assert.ok(why.seeds.length >= 1);
    assert.ok(why.session.length >= 1);
  } finally {
    forge.close();
  }
});

test("ContextForge can index and understand the repository hosting itself", async () => {
  const forge = createContextForge(repoRoot, { sessionId: `self_hosted_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.filesIndexed > 0);

    const overview = forge.understand("go through every single file folder and subfolder in this whole project and explain what they are doing");
    assert.ok(overview.topLevel.length > 0);
    assert.ok(overview.importantFiles.length > 0);
    assert.match(overview.summary, /Important files to read first/i);
  } finally {
    forge.close();
  }
});
