import { pageAffinity } from "./affinity.js";

export function scorePageForEviction(page, context = {}, now = Date.now()) {
  const ageMs = Math.max(now - page.lastUsedAt, 1);
  const recencyPenalty = ageMs / 1000;
  const pinBonus = page.pinState === "pinned" ? 1000 : 0;
  const faultBonus = (page.faultCount ?? 0) * 5;
  const affinity = pageAffinity(page, context);
  return recencyPenalty - faultBonus - pinBonus + (page.sizeEstimate ?? 0) / 500 - affinity.keepScore;
}

export function chooseEvictions(pages, zone, context = {}) {
  if (zone === "green") {
    return [];
  }

  const scored = pages
    .filter((page) => page.pinState !== "pinned")
    .map((page) => ({
      ...page,
      evictionScore: scorePageForEviction(page, context)
    }))
    .sort((left, right) => right.evictionScore - left.evictionScore);

  return zone === "yellow" ? scored.slice(0, 1) : scored.slice(0, Math.max(1, Math.ceil(scored.length / 2)));
}
