const BROAD_HINTS = [
  "architecture",
  "architectural",
  "overview",
  "system",
  "module",
  "modules",
  "design",
  "how does",
  "explain",
  "flow",
  "dependency graph"
];

const PINPOINT_HINTS = [
  "which file",
  "which files",
  "where is",
  "where does",
  "who calls",
  "used by",
  "implement",
  "implementation",
  "root cause",
  "likely involved",
  "same bug",
  "blast radius",
  "what breaks"
];

const EXACT_HINTS = [
  "symbol",
  "function",
  "class",
  "method",
  "lookup",
  "find symbol"
];

export function routeRaptorStrategy(query) {
  const text = String(query ?? "").trim().toLowerCase();
  const tokenCount = text.split(/\s+/).filter(Boolean).length;

  if (!text) {
    return { strategy: "flat", reason: "empty_query" };
  }

  if (EXACT_HINTS.some((hint) => text.includes(hint)) || tokenCount <= 2) {
    return { strategy: "flat", reason: "exact_or_short_query" };
  }

  if (PINPOINT_HINTS.some((hint) => text.includes(hint)) || /\b(where|which|who)\b/.test(text)) {
    return { strategy: "traversal", reason: "pinpoint_hints" };
  }

  if (BROAD_HINTS.some((hint) => text.includes(hint)) || tokenCount >= 8) {
    return { strategy: "collapsed", reason: "broad_hints" };
  }

  return { strategy: "flat", reason: "default_flat" };
}
