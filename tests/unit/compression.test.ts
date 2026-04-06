import test from "node:test";
import assert from "node:assert/strict";

import { safeCompress } from "../../src/compression/safe-compress.js";

test("safeCompress reduces repetitive logs", async () => {
  const log = [
    "2026-01-01 INFO starting checkout",
    "2026-01-01 INFO starting checkout",
    "2026-01-01 ERROR timeout at checkout",
    "2026-01-01 ERROR timeout at checkout"
  ].join("\n");

  const result = await safeCompress(log, { contentType: "log" });
  assert.ok(result.compressed.length <= log.length);
  assert.equal(result.fidelity.ok, true);
});
