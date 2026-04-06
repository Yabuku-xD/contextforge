const TRIVIAL_PATTERNS = [
  /^\s*(hi|hello|hey|thanks|thank you|yo)\s*[.!?]*\s*$/i,
  /^\s*what time is it\??\s*$/i
];

const COMPLEX_HINTS = [
  "refactor",
  "architecture",
  "project structure",
  "repo structure",
  "whole project",
  "entire project",
  "entire repo",
  "entire repository",
  "full codebase",
  "monorepo",
  "codebase exploration",
  "comprehensive",
  "all files",
  "every file",
  "every single file",
  "go through",
  "directory",
  "directories",
  "folder",
  "folders",
  "subfolder",
  "subfolders",
  "package",
  "packages",
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
  if (isBroadRepoPrompt(lowered)) {
    return { label: "complex", confidence: 0.9, reason: "broad_repo_prompt" };
  }

  const complexHits = COMPLEX_HINTS.filter((term) => lowered.includes(term)).length;
  let complexityScore = complexHits;

  if (/\bwhy\b/.test(lowered)) complexityScore += 1;
  if (/\bhow\b/.test(lowered)) complexityScore += 0.5;
  if (/\bexplain\b/.test(lowered)) complexityScore += 1;
  if (/\bunderstand\b/.test(lowered)) complexityScore += 1;
  if (/\boverview\b/.test(lowered)) complexityScore += 1;
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

function isBroadRepoPrompt(lowered) {
  const repoTarget = /\b(project|repo|repository|monorepo|codebase|structure)\b/.test(lowered);
  const broadIntent = /\b(understand|explain|overview|map|summarize|walk through|go through|analyze)\b/.test(lowered);
  const exhaustiveScope = /\b(all|every|entire|whole|complete|comprehensive)\b/.test(lowered);
  const fileTreeTerms = /\b(files?|folders?|subfolders?|directories|packages?)\b/.test(lowered);

  return (repoTarget && broadIntent) || (exhaustiveScope && fileTreeTerms);
}
