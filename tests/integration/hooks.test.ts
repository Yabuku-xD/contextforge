import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runPostToolUse,
  runPreCompact,
  runPreToolUse,
  runSessionStart
} from "../../src/hooks/runtime.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

function writableTempBase() {
  const candidates = [os.tmpdir(), path.resolve(".tmp-tests")];
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No writable temp directory available for hook tests.");
}

test("hooks reuse the active session across separate calls", async () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-hooks-"));
  fs.cpSync(sampleRepo, tempRoot, { recursive: true });
  fs.rmSync(path.join(tempRoot, ".contextforge"), { recursive: true, force: true });

  const startup = runSessionStart(tempRoot, "why is checkout timing out?");
  assert.ok(startup.sessionId);

  const compressed = await runPreToolUse(tempRoot, "<div class=\"error\">Gateway timeout</div>", {
    filePath: "snapshot.html"
  });
  assert.equal(compressed.sessionId, startup.sessionId);

  runPostToolUse(tempRoot, "edit", {
    filePath: "src/checkout.ts",
    symbolId: "createCheckout"
  });
  runPostToolUse(tempRoot, "failure", {
    filePath: "src/checkout.ts",
    symbolId: "createCheckout",
    message: "Gateway timeout"
  });

  const resume = runPreCompact(tempRoot);
  assert.equal(resume.sessionId, startup.sessionId);
  assert.ok(resume.summary.includes("failure"));
});
