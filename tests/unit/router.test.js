import test from "node:test";
import assert from "node:assert/strict";

import { classifyTask } from "../../src/router/classify-task.js";
import { classifyContent } from "../../src/router/classify-content.js";
import { decideRoute } from "../../src/router/bypass-policy.js";

test("classifyTask distinguishes trivial and complex prompts", () => {
  assert.equal(classifyTask("hi").label, "trivial");
  assert.equal(classifyTask("refactor the auth module and explain the root cause").label, "complex");
  assert.equal(classifyTask("why is checkout timing out and which files are likely involved?").label, "complex");
});

test("classifyContent detects code logs and dom snapshots", () => {
  assert.equal(classifyContent("export function demo() {\n  return 1;\n}", { filePath: "demo.js" }), "code");
  assert.equal(classifyContent("2026-01-01 INFO server started\n2026-01-01 ERROR timeout", { filePath: "server.log" }), "log");
  assert.equal(classifyContent("<button data-testid=\"checkout-submit\">Submit</button>", { filePath: "snapshot.html" }), "dom_snapshot");
});

test("bypass policy keeps code exact and logs compressible", () => {
  assert.equal(decideRoute("code"), "exact");
  assert.equal(decideRoute("log"), "lossy_safe_with_invariant_check");
});
