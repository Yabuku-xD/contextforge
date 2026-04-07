import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { createContextForge } from "../../src/contextforge.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");
const memoryRoot = path.join(os.tmpdir(), "contextforge-memory-tests", "pdg");
fs.mkdirSync(memoryRoot, { recursive: true });

test("PDG import and call edges resolve real symbols in the sample app", () => {
  const forge = createContextForge(sampleRepo, { sessionId: "pdg_unit", memoryRoot });
  try {
    forge.indexRepository();
    const edges = forge._loadEdges();
    const symbols = forge._loadSymbols();
    const createCheckout = symbols.find((symbol) => symbol.displayName === "createCheckout");
    const shouldRetry = symbols.find((symbol) => symbol.displayName === "shouldRetry");
    const requireUser = symbols.find((symbol) => symbol.displayName === "requireUser");

    assert.ok(edges.some((edge) => edge.edgeType === "import" && edge.fromSymbolId === createCheckout.symbolId && edge.toSymbolId === shouldRetry.symbolId));
    assert.ok(edges.some((edge) => edge.edgeType === "call" && edge.fromSymbolId === createCheckout.symbolId && edge.toSymbolId === requireUser.symbolId));
    assert.ok(forge.impact("shouldRetry").some((symbol) => symbol.displayName === "createCheckout"));
  } finally {
    forge.close();
  }
});
