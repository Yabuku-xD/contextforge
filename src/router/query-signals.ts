// Shared prompt-signal extractor for ContextForge routing.
//
// All layers that route a user prompt to a tool / strategy / load plan
// should go through this module instead of keeping their own keyword lists.
// Adding a synonym here propagates to every routing layer.

const SYNONYMS: Record<string, string> = {
  // repo surface
  "repos": "repository",
  "repo": "repository",
  "code base": "codebase",
  "code-base": "codebase",
  "mono repo": "monorepo",
  "mono-repo": "monorepo",

  // file tree surface
  "dirs": "directory",
  "dir": "directory",
  "directories": "directory",
  "folders": "folder",
  "sub folder": "subfolder",
  "sub-folder": "subfolder",
  "sub folders": "subfolder",
  "sub-folders": "subfolder",
  "subfolders": "subfolder",
  "files": "file",
  "pkgs": "package",
  "pkg": "package",
  "packages": "package",
  "modules": "module",

  // broad scope
  "all of": "all",
  "each and every": "every",

  // intent
  "walk through": "walk",
  "walkthrough": "walk",
  "go through": "walk",
  "go over": "walk",
  "look through": "walk",
  "look over": "walk"
};

const BROAD_SCOPE_WORDS = [
  "every",
  "all",
  "each",
  "entire",
  "whole",
  "complete",
  "comprehensive",
  "full",
  "exhaustive"
];

const FILE_TREE_WORDS = [
  "file",
  "folder",
  "subfolder",
  "directory",
  "package",
  "module",
  "area"
];

const REPO_TARGET_WORDS = [
  "repository",
  "project",
  "codebase",
  "monorepo",
  "structure"
];

const BROAD_INTENT_WORDS = [
  "understand",
  "explain",
  "overview",
  "map",
  "summarize",
  "summary",
  "analyze",
  "analyse",
  "walk",
  "scan",
  "audit",
  "tour",
  "explore"
];

const PINPOINT_PHRASES = [
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
  "what breaks",
  "what breaks if"
];

const EXACT_HINT_WORDS = [
  "symbol",
  "function",
  "class",
  "method",
  "lookup",
  "find symbol",
  "jump to",
  "definition of"
];

const OUTPUT_HEAVY_COMMANDS = [
  /\bgit\s+diff\b/i,
  /\bgit\s+log\b/i,
  /\bnpm\s+test\b/i,
  /\bpnpm\s+test\b/i,
  /\byarn\s+test\b/i,
  /\bpytest\b/i,
  /\bcargo\s+test\b/i,
  /\bgo\s+test\b/i,
  /\brg\s+.+/i,
  /\bgrep\s+-R\b/i,
  /\bcat\s+.+/i
];

const BROAD_DISCOVERY_COMMANDS = [
  /\bfind\s+\S*\s*-maxdepth\b/i,
  /\bfind\s+\S*\s+-type\s+f\b/i,
  /\btree\b/i,
  /\bls\s+-R\b/i,
  /\brg\s+--files\b/i,
  /\bfd\b/i,
  /\bgit\s+ls-files\b/i
];

const NEGATION_TOKENS = [
  "don't",
  "do not",
  "dont",
  "not",
  "just",
  "only",
  "except",
  "skip",
  "ignore",
  "avoid",
  "without"
];

// Explicit path-like tokens (src/foo, tests/bar/baz.ts) signal a scoped request
// that should downgrade "exhaustive" intent to "targeted".
const PATH_SHAPE = /\b[a-z0-9_.\-]+\/[a-z0-9_./\-]+/gi;

// Identifier shapes that hint at an exact-symbol query even without an explicit
// "symbol"/"function" keyword: CamelCase, snake_case, dotted, arrow/paren.
const IDENTIFIER_SHAPE = /[A-Z][a-zA-Z0-9]+[A-Z]|_[a-z]|[a-z][A-Z]|\.[a-zA-Z_$][\w$]*\(|\(\)/;

function normalize(text: unknown): string {
  const raw = String(text ?? "").toLowerCase();
  // Collapse punctuation around words but keep path slashes and identifier chars
  // so IDENTIFIER_SHAPE still matches the original casing later.
  let out = raw
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\w\s'/.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Apply multi-word synonyms first (longest first so "sub-folders" wins
  // before "sub" alone can do anything).
  const multiWordKeys = Object.keys(SYNONYMS)
    .filter((key) => key.includes(" ") || key.includes("-"))
    .sort((left, right) => right.length - left.length);
  for (const key of multiWordKeys) {
    if (out.includes(key)) {
      out = out.split(key).join(SYNONYMS[key]);
    }
  }

  // Then apply single-token synonyms on tokenized text.
  out = out
    .split(" ")
    .map((token) => {
      const stripped = token.replace(/^[^\w]+|[^\w]+$/g, "");
      if (!stripped) {
        return token;
      }
      const replacement = SYNONYMS[stripped];
      return replacement ?? token;
    })
    .join(" ");

  return out;
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function containsAny(text: string, needles: string[]): boolean {
  for (const needle of needles) {
    if (!needle) continue;
    if (needle.includes(" ")) {
      if (text.includes(needle)) return true;
    } else {
      const pattern = new RegExp(`\\b${escapeRegExp(needle)}\\b`);
      if (pattern.test(text)) return true;
    }
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export type QuerySignals = {
  raw: string;
  normalized: string;
  tokens: string[];
  length: number;
  tokenCount: number;
  broadScope: boolean;
  fileTreeTerm: boolean;
  repoTarget: boolean;
  broadIntent: boolean;
  exhaustive: boolean;
  broadRepo: boolean;
  pinpoint: boolean;
  exactSymbol: boolean;
  outputHeavy: boolean;
  broadDiscovery: boolean;
  negation: boolean;
  scopeHints: string[];
  complexityScore: number;
};

export function extractQuerySignals(input: unknown): QuerySignals {
  const raw = String(input ?? "");
  const normalized = normalize(raw);
  const tokens = tokenize(normalized);

  const broadScope = containsAny(normalized, BROAD_SCOPE_WORDS);
  const fileTreeTerm = containsAny(normalized, FILE_TREE_WORDS);
  const repoTarget = containsAny(normalized, REPO_TARGET_WORDS);
  const broadIntent = containsAny(normalized, BROAD_INTENT_WORDS);
  const pinpoint =
    PINPOINT_PHRASES.some((phrase) => normalized.includes(phrase)) ||
    /\b(where|which|who)\b/.test(normalized);
  const exactSymbol =
    EXACT_HINT_WORDS.some((hint) => normalized.includes(hint)) ||
    IDENTIFIER_SHAPE.test(raw);

  const outputHeavy = matchesAny(raw, OUTPUT_HEAVY_COMMANDS);
  const broadDiscovery = matchesAny(raw, BROAD_DISCOVERY_COMMANDS);

  const scopeHints = Array.from(raw.matchAll(PATH_SHAPE)).map((match) => match[0]);
  const negation = containsAny(normalized, NEGATION_TOKENS);

  // "exhaustive" = explicit ask to cover the whole repo.
  // Requires (broad scope word + file-tree word) OR ("walk"/"audit" + repo target)
  // OR the canonical "every single file" / "go through every" cues.
  const exhaustive =
    (broadScope && fileTreeTerm) ||
    (/\b(walk|audit|exhaustive)\b/.test(normalized) &&
      (repoTarget || fileTreeTerm)) ||
    /\bevery\s+single\s+file\b/.test(normalized) ||
    /\bwalk\s+every\b/.test(normalized);

  // "broadRepo" = any broad repo understanding intent, weaker than exhaustive.
  const broadRepo =
    exhaustive ||
    (repoTarget && broadIntent) ||
    (broadIntent && fileTreeTerm) ||
    /\bproject\s+structure\b/.test(normalized) ||
    /\barchitecture\s+overview\b/.test(normalized);

  let complexityScore = 0;
  if (broadRepo) complexityScore += 2;
  if (exhaustive) complexityScore += 1;
  if (pinpoint) complexityScore += 1;
  if (/\bwhy\b/.test(normalized)) complexityScore += 1;
  if (/\bhow\b/.test(normalized)) complexityScore += 0.5;
  if (/\bexplain\b/.test(normalized)) complexityScore += 1;
  if (/\bunderstand\b/.test(normalized)) complexityScore += 1;
  if (/\boverview\b/.test(normalized)) complexityScore += 1;
  if (/\bimpact\b|\baffect\b|\bbreak\b/.test(normalized)) complexityScore += 1;
  if (/\bwhere\b|\bwhich\b/.test(normalized)) complexityScore += 0.5;
  if (raw.length > 180) complexityScore += 1;
  if (raw.includes("?")) complexityScore += 0.5;

  return {
    raw,
    normalized,
    tokens,
    length: raw.length,
    tokenCount: tokens.length,
    broadScope,
    fileTreeTerm,
    repoTarget,
    broadIntent,
    exhaustive,
    broadRepo,
    pinpoint,
    exactSymbol,
    outputHeavy,
    broadDiscovery,
    negation,
    scopeHints,
    complexityScore
  };
}

// Deterministic tool recommendation from signals. Used by skills and by the
// general contextforge router skill so the first-choice tool is predictable.
export function recommendForgeTool(signals: QuerySignals): {
  tool: string;
  reason: string;
} {
  if (signals.broadDiscovery) {
    return { tool: "forge_scan", reason: "broad_discovery_command" };
  }
  if (signals.exhaustive && !signals.negation && signals.scopeHints.length === 0) {
    return { tool: "forge_walk", reason: "exhaustive_whole_repo_request" };
  }
  if (signals.broadRepo && !signals.negation) {
    return { tool: "forge_understand", reason: "broad_repo_understanding" };
  }
  if (signals.exactSymbol) {
    return { tool: "forge_symbol", reason: "exact_symbol_query" };
  }
  if (signals.pinpoint) {
    return { tool: "forge_impact", reason: "pinpoint_blast_radius" };
  }
  if (signals.outputHeavy) {
    return { tool: "forge_batch", reason: "output_heavy_shell" };
  }
  return { tool: "forge_search", reason: "default_search" };
}
