import test from "node:test";
import assert from "node:assert/strict";

import { createPage } from "../../src/pager/pages.js";
import { noteFault } from "../../src/pager/page-faults.js";
import { maybePinPage } from "../../src/pager/pinning.js";
import { pressureZone } from "../../src/pager/pressure-zones.js";
import { chooseEvictions } from "../../src/pager/eviction.js";

test("pager pins a page after repeated faults", () => {
  const page = createPage({
    sessionId: "session_1",
    pageType: "tool_schema",
    sourceItemType: "tool",
    sourceItemId: "ctx_get_tool",
    sizeEstimate: 200
  });

  const pinned = maybePinPage(noteFault(noteFault(page)));
  assert.equal(pinned.pinState, "pinned");
});

test("pager computes pressure zones and eviction candidates", () => {
  const pages = [
    createPage({ sessionId: "s", pageType: "tool_schema", sourceItemType: "tool", sourceItemId: "a", sizeEstimate: 500 }),
    createPage({ sessionId: "s", pageType: "module", sourceItemType: "module", sourceItemId: "b", sizeEstimate: 500 }),
    createPage({ sessionId: "s", pageType: "retrieval_pack", sourceItemType: "file", sourceItemId: "c", sizeEstimate: 400 })
  ];

  const zone = pressureZone(1200, 1400);
  assert.equal(zone, "red");
  assert.ok(chooseEvictions(pages, zone).length >= 1);
});

test("pager prefers evicting stale unrelated pages over active failure context", () => {
  const pages = [
    createPage({ sessionId: "s", pageType: "retrieval_pack", sourceItemType: "file", sourceItemId: "src/checkout.ts", sizeEstimate: 400 }),
    createPage({ sessionId: "s", pageType: "session_memory", sourceItemType: "symbol", sourceItemId: "createCheckout", sizeEstimate: 260 }),
    createPage({ sessionId: "s", pageType: "module", sourceItemType: "module", sourceItemId: "testing", sizeEstimate: 420 })
  ].map((page, index) => ({
    ...page,
    lastUsedAt: page.lastUsedAt - index * 10_000
  }));

  const evictions = chooseEvictions(pages, "red", {
    activeFiles: ["src/checkout.ts"],
    failureFiles: ["src/checkout.ts"],
    failureSymbols: ["createCheckout"]
  });

  assert.equal(evictions[0]?.sourceItemId, "testing");
});
