import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runOpenTrack, runReleaseGates } from "../../src/open-track.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("open track report includes built-in baselines, external slots, and release gates", async () => {
  const report = await runOpenTrack(sampleRepo);

  assert.equal(report.fixtures.endToEnd, 8);
  assert.ok(report.baselines.some((baseline) => baseline.name === "bare_workflow" && baseline.available));
  assert.ok(report.baselines.some((baseline) => baseline.name === "contextforge" && baseline.available));
  assert.ok(report.baselines.some((baseline) => baseline.name === "context_mode" && baseline.available));
  assert.ok(report.baselines.some((baseline) => baseline.name === "token_savior" && baseline.available));
  assert.equal(report.summary.winners.startup.name, "contextforge");
  assert.equal(report.summary.winners.retrieval.name, "contextforge");
  assert.equal(report.summary.winners.endToEnd.name, "contextforge");
  assert.equal(report.baselines.find((baseline) => baseline.name === "contextforge").summary.session.recallAtK, 1);
  assert.equal(report.releaseGates.overallStatus, "pass");
});

test("release gate command stays honest when open-track baselines are missing", async () => {
  const gates = await runReleaseGates(sampleRepo);

  assert.equal(gates.overallStatus, "pass");
  assert.ok(!gates.missingBaselines.includes("context_mode"));
  assert.ok(!gates.missingBaselines.includes("token_savior"));
  assert.equal(gates.gates.compression.status, "pass");
  assert.equal(gates.gates.retrieval.status, "pass");
  assert.equal(gates.gates.endToEnd.status, "pass");
});
