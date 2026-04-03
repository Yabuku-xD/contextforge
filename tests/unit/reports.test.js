import test from "node:test";
import assert from "node:assert/strict";

import { reportInventory, validateReportFile } from "../../src/reports.js";

test("report validator accepts the bundled context_mode report", () => {
  const report = validateReportFile("benchmark/open-track/context_mode.report.json");
  assert.equal(report.name, "context_mode");
  assert.equal(report.available, true);
  assert.equal(report.summary.endToEnd.tokensPerSuccessfulTask, 176);
});

test("report inventory tracks bundled and missing baseline files", () => {
  const inventory = reportInventory();
  const contextMode = inventory.openTrack.find((entry) => entry.name === "context_mode");
  const tokenSavior = inventory.openTrack.find((entry) => entry.name === "token_savior");

  assert.equal(contextMode.present, true);
  assert.equal(contextMode.valid, true);
  assert.equal(tokenSavior.present, true);
  assert.equal(tokenSavior.valid, true);
  assert.deepEqual(inventory.closedTrack, []);
});
