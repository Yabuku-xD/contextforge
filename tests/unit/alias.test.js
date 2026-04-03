import test from "node:test";
import assert from "node:assert/strict";

import { resolveAliasSeeds } from "../../src/graph/alias-resolution.js";

test("alias resolution expands code-ish synonyms and identifier variants", () => {
  const symbols = [
    { symbolId: "symbol_parse", displayName: "parseSession", canonicalName: "src/auth.js::parseSession" },
    { symbolId: "symbol_backoff", displayName: "backoffMs", canonicalName: "src/retry.js::backoffMs" }
  ];

  assert.equal(resolveAliasSeeds("authentication credentials", symbols, 2)[0], "symbol_parse");
  assert.equal(resolveAliasSeeds("payment backoff", symbols, 2)[0], "symbol_backoff");
});
