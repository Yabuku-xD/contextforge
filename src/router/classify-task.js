const TRIVIAL_PATTERNS = [
  /^\s*(hi|hello|hey|thanks|thank you|yo)\s*[.!?]*\s*$/i,
  /^\s*what time is it\??\s*$/i
];

const COMPLEX_HINTS = [
  "refactor",
  "architecture",
  "why does",
  "why is",
  "which files",
  "likely involved",
  "timing out",
  "what changed",
  "same bug as yesterday",
  "undo that",
  "root cause",
  "blast radius",
  "dependency",
  "multi-step",
  "session",
  "benchmark",
  "migrate",
  "rewrite"
];

export function classifyTask(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return { label: "trivial", confidence: 1, reason: "empty_input" };
  }

  if (TRIVIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { label: "trivial", confidence: 0.98, reason: "trivial_pattern" };
  }

  const lowered = text.toLowerCase();
  const complexHits = COMPLEX_HINTS.filter((term) => lowered.includes(term)).length;
  let complexityScore = complexHits;

  if (/\bwhy\b/.test(lowered)) complexityScore += 1;
  if (/\bhow\b/.test(lowered)) complexityScore += 0.5;
  if (/\bexplain\b/.test(lowered)) complexityScore += 1;
  if (/\bimpact\b|\baffect\b|\bbreak\b/.test(lowered)) complexityScore += 1;
  if (/\bwhere\b|\bwhich\b/.test(lowered)) complexityScore += 0.5;
  if (text.length > 180) complexityScore += 1;
  if (text.includes("?")) complexityScore += 0.5;

  if (complexityScore >= 2.5) {
    return { label: "complex", confidence: 0.84, reason: "complex_hints" };
  }

  if (/\bfix\b|\bfind\b|\bsearch\b|\blookup\b|\bshow\b|\badd\b/.test(lowered)) {
    return { label: "simple", confidence: 0.78, reason: "actionable_simple" };
  }

  return { label: "simple", confidence: 0.7, reason: "default_simple" };
}
