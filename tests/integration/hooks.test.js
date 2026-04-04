import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sessionStart } from "../../hooks/session-start.js";
import { preToolUse } from "../../hooks/pre-tool-use.js";
import { postToolUse } from "../../hooks/post-tool-use.js";
import { preCompact } from "../../hooks/pre-compact.js";

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

  const startup = sessionStart(tempRoot, "why is checkout timing out?");
  assert.ok(startup.sessionId);

  const compressed = await preToolUse(tempRoot, "<div class=\"error\">Gateway timeout</div>", {
    filePath: "snapshot.html"
  });
  assert.equal(compressed.sessionId, startup.sessionId);

  postToolUse(tempRoot, "edit", {
    filePath: "src/checkout.ts",
    symbolId: "createCheckout"
  });
  postToolUse(tempRoot, "failure", {
    filePath: "src/checkout.ts",
    symbolId: "createCheckout",
    message: "Gateway timeout"
  });

  const resume = preCompact(tempRoot);
  assert.equal(resume.sessionId, startup.sessionId);
  assert.ok(resume.summary.includes("failure"));
});
