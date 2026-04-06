import { extractQuerySignals } from "../../router/query-signals.js";

export function routeRaptorStrategy(query) {
  const text = String(query ?? "").trim();
  if (!text) {
    return { strategy: "flat", reason: "empty_query" };
  }

  const signals = extractQuerySignals(text);

  if (signals.exactSymbol || signals.tokenCount <= 2) {
    return { strategy: "flat", reason: "exact_or_short_query" };
  }

  if (signals.pinpoint) {
    return { strategy: "traversal", reason: "pinpoint_hints" };
  }

  if (signals.broadRepo || signals.exhaustive || signals.tokenCount >= 8) {
    return { strategy: "collapsed", reason: "broad_hints" };
  }

  return { strategy: "flat", reason: "default_flat" };
}
