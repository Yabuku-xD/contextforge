import test from "node:test";
import assert from "node:assert/strict";

import { routeRaptorStrategy } from "../../src/retrieval/raptor/route.js";

test("RAPTOR routing distinguishes flat collapsed and traversal modes", () => {
  assert.equal(routeRaptorStrategy("shouldRetry").strategy, "flat");
  assert.equal(routeRaptorStrategy("architecture overview of checkout and retry flow").strategy, "collapsed");
  assert.equal(routeRaptorStrategy("which files are likely involved in checkout timeout").strategy, "traversal");
});
