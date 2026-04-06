import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runReleaseStatus } from "../../src/release.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("release status marks the product and benchmark evidence ready", async () => {
  const report = await runReleaseStatus(sampleRepo);

  assert.equal(report.coreProduct.status, "ready");
  assert.equal(report.benchmarkEvidence.status, "pass");
  assert.deepEqual(report.benchmarkEvidence.missingExternalReports, []);
  assert.equal(report.overallStatus, "ready");
});
