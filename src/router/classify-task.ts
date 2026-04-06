import { extractQuerySignals } from "./query-signals.js";

const TRIVIAL_PATTERNS = [
  /^\s*(hi|hello|hey|thanks|thank you|yo)\s*[.!?]*\s*$/i,
  /^\s*what time is it\??\s*$/i
];

export function classifyTask(message) {
  const text = String(message ?? "").trim();
  if (!text) {
    return { label: "trivial", confidence: 1, reason: "empty_input" };
  }

  if (TRIVIAL_PATTERNS.some((pattern) => pattern.test(text))) {
    return { label: "trivial", confidence: 0.98, reason: "trivial_pattern" };
  }

  const signals = extractQuerySignals(text);

  if (signals.broadRepo || signals.exhaustive) {
    return { label: "complex", confidence: 0.9, reason: "broad_repo_prompt" };
  }

  if (signals.complexityScore >= 2.5) {
    return { label: "complex", confidence: 0.84, reason: "complex_hints" };
  }

  const lowered = signals.normalized;
  if (/\bfix\b|\bfind\b|\bsearch\b|\blookup\b|\bshow\b|\badd\b/.test(lowered)) {
    return { label: "simple", confidence: 0.78, reason: "actionable_simple" };
  }

  return { label: "simple", confidence: 0.7, reason: "default_simple" };
}
