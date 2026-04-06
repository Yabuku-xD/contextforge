import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runPhase3, runSweBenchSubset, runClosedTrack } from "../../src/phase3.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("phase 3 runner includes open track, swebench subset, and closed-track gating", async () => {
  const report = await runPhase3(sampleRepo);

  assert.equal(report.swebench.taskCount, 5);
  assert.equal(report.swebench.summary.winner.name, "contextforge");
  assert.equal(report.openTrack.releaseGates.overallStatus, "pass");
  assert.equal(report.closedTrack.releaseGates.overallStatus, "pass");
  assert.deepEqual(report.closedTrack.releaseGates.missingBaselines, []);
  assert.equal(report.phaseStatus.overallStatus, "pass");
});

test("closed track and swebench helpers stay callable on their own", async () => {
  const swebench = await runSweBenchSubset(sampleRepo);
  const closedTrack = await runClosedTrack(sampleRepo);

  assert.equal(swebench.gates.bestBaseline, "contextforge");
  assert.equal(closedTrack.taskCounts.swebenchSubset, 5);
});
