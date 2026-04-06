import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runBenchmarks } from "../../src/benchmark.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("benchmark runner covers startup compression retrieval session and pager suites", async () => {
  const report = await runBenchmarks(sampleRepo);
  assert.equal(report.startup[0].label, "trivial");
  assert.equal(report.startup[2].label, "complex");
  assert.ok(report.compression.length >= 3);
  assert.ok(report.compression.some((entry) => entry.route === "lossy_safe_with_invariant_check"));
  assert.equal(report.compression.find((entry) => entry.name === "dom_snapshot")?.contentType, "dom_snapshot");
  assert.equal(
    report.stats.compression.count,
    report.compression.filter((entry) => entry.route === "lossy_safe_with_invariant_check").length
  );
  assert.ok(report.alias[0].topSymbol?.includes("parseSession"));
  assert.equal(report.raptor[0].plan.strategy, "collapsed");
  assert.equal(report.raptor[1].plan.strategy, "traversal");
  assert.ok(report.impact.find((entry) => entry.query === "shouldRetry")?.impacted.some((name) => name.includes("createCheckout")));
  assert.ok(report.session.resume.summary.includes("decision"));
  assert.ok(report.session.why.seeds.length >= 1);
  assert.ok(report.pager.after.pages.length >= 2);
});
