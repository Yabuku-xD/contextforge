import { makeId } from "../indexing/canonicalize.js";
import { scorePageForEviction } from "./eviction.js";

export function createPage({ sessionId, pageType, sourceItemType, sourceItemId, sizeEstimate }): any {
  return {
    pageId: makeId("page", `${sessionId}:${pageType}:${sourceItemType}:${sourceItemId}`),
    sessionId,
    pageType,
    sourceItemType,
    sourceItemId,
    sizeEstimate,
    pinState: "none",
    faultCount: 0,
    lastUsedAt: Date.now(),
    evictionScore: 0
  };
}

export function touchPage(page): any {
  const next = {
    ...page,
    lastUsedAt: Date.now()
  };
  next.evictionScore = scorePageForEviction(next);
  return next;
}
