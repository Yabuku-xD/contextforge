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

const WHY_PHRASES = [
  "why does this file matter",
  "why does this matter",
  "why is this important",
  "what is this for",
  "what's this for",
  "what is the purpose of",
  "why does this exist",
  "why was this added",
  "what does this do",
  "what is the role of",
  "why do we have this",
  "what is responsible for"
];

const IMPACT_PHRASES = [
  "what breaks if",
  "what else is affected",
  "who depends on",
  "who uses this",
  "what uses this",
  "blast radius",
  "impact of",
  "affected by this",
  "downstream impact",
  "upstream impact"
];

const CHANGES_PHRASES = [
  "what changed",
  "what's changed",
  "summarize the diff",
  "summarise the diff",
  "show the diff",
  "map these changes",
  "review the changes",
  "what changed on this branch",
  "what touched this branch",
  "which files changed",
  "what did this commit touch",
  "what was modified",
  "changed on this branch"
];

const RENAME_PHRASES = [
  "rename this symbol",
  "rename this api",
  "rename across the repo",
  "rename across repo",
  "rename throughout the repo",
  "rename this across the codebase",
  "rename this class",
  "rename this function",
  "rename this method",
  "rename this variable",
  "rename "
];

const SCOPE_PHRASES = [
  "how is this area structured",
  "how is this project structured",
  "which modules talk to each other",
  "which module talk to each other",
  "how do these modules fit together",
  "how do these module fit together",
  "how does this area fit together",
  "show the flow between",
  "show the architecture of",
  "show the wiring",
  "how do these parts interact",
  "relationship between"
];

const MEMORY_WAKEUP_PHRASES = [
  "what should you remember",
  "load prior decisions",
  "wake up memory",
  "before we continue",
  "before we move on",
  "what should i know before continuing",
  "remind yourself"
];

const MEMORY_SAVE_PHRASES = [
  "remember this",
  "save this decision",
  "store this long term",
  "store this long-term",
  "save this long term",
  "save this long-term",
  "don't forget this",
  "keep this in mind",
  "persist this memory"
];

const MEMORY_SEARCH_PHRASES = [
  "what do you remember about",
  "search memory",
  "search remembered",
  "search past notes",
  "find past notes",
  "verify this remembered fact",
  "did we decide",
  "what did we decide",
  "what have we said before",
  "what do you recall about"
];

const MEMORY_NAVIGATE_PHRASES = [
  "memory map",
  "memory rooms",
  "memory wings",
  "memory halls",
  "navigate memory",
  "show the memory layout",
  "show the memory topology"
];

const MEMORY_TIMELINE_PHRASES = [
  "timeline of",
  "what changed over time",
  "history of",
  "when did this change",
  "sequence of remembered",
  "remembered history"
];

const LOOKUP_PHRASES = [
  "search the logs from earlier",
  "search the saved logs from earlier",
  "saved test output",
  "stored output",
  "from earlier logs",
  "from the earlier batch",
  "previous command results",
  "that stored output",
  "saved output from before"
];

const BATCH_PHRASES = [
  "run tests and summarize",
  "inspect logs",
  "check ci output",
  "summarize the failures",
  "show git diff without flooding chat",
  "collect command output",
  "inspect this log output",
  "summarize test output"
];

const READ_WORDS = [
  "read",
  "open",
  "show",
  "display",
  "peek",
  "view",
  "cat",
  "print",
  "list"
];

const EDIT_WORDS = [
  "replace",
  "patch",
  "edit",
  "update",
  "change",
  "swap",
  "rewrite"
];

const WRITE_WORDS = [
  "create",
  "write",
  "overwrite",
  "save file",
  "new file",
  "replace the full file"
];

const RESUME_PHRASES = [
  "continue where we left off",
  "resume the session",
  "pick up where we left off",
  "load the last session",
  "continue the previous work",
  "resume prior work"
];

const ARTIFACT_MAP_PHRASES = [
  "repo map",
  "repository map",
  "project map",
  "architecture map",
  "map of the repo",
  "map of the repository"
];

const ARTIFACT_WIKI_PHRASES = [
  "repo wiki",
  "repository wiki",
  "project wiki",
  "generate the wiki",
  "living wiki"
];

const ARTIFACT_CONTRACT_PHRASES = [
  "integration contracts",
  "show the contracts",
  "cross area contracts",
  "cross-area contracts"
];

const LIST_REPOS_PHRASES = [
  "what repos are registered",
  "what repository are registered",
  "list registered repos",
  "list registered repository",
  "show registered repositories",
  "show registered repository",
  "which repos do you know about"
];

const GROUP_QUERY_PHRASES = [
  "search across grouped repos",
  "search across grouped repository",
  "query across grouped repos",
  "query across grouped repository",
  "search across repo group",
  "query across repo group"
];

const GROUP_STATUS_PHRASES = [
  "group status",
  "status across grouped repos",
  "status across grouped repository",
  "repo group status",
  "status of the repo group"
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
const FILE_HINT_SHAPE = /\b(?=[a-z0-9._-]*[a-z])[a-z0-9._-]+\.[a-z0-9._-]+\b/gi;

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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
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
  shellIntent: boolean;
  broadDiscovery: boolean;
  negation: boolean;
  intentWhy: boolean;
  intentImpact: boolean;
  intentChanges: boolean;
  intentRename: boolean;
  intentScope: boolean;
  intentMemoryWakeup: boolean;
  intentMemorySave: boolean;
  intentMemorySearch: boolean;
  intentMemoryNavigate: boolean;
  intentMemoryTimeline: boolean;
  intentLookup: boolean;
  intentBatch: boolean;
  intentRead: boolean;
  intentEdit: boolean;
  intentWrite: boolean;
  intentResume: boolean;
  intentMap: boolean;
  intentWiki: boolean;
  intentContracts: boolean;
  intentListRepos: boolean;
  intentGroupQuery: boolean;
  intentGroupStatus: boolean;
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
  const shellIntent =
    /\b(run|execute)\b/.test(normalized) ||
    /\b(git|npm|pnpm|yarn|pytest|cargo|go|node|deno|bun|ls|pwd|cat|find|tree|rg|grep)\b/.test(normalized);
  const broadDiscovery = matchesAny(raw, BROAD_DISCOVERY_COMMANDS);

  const scopeHints = unique([
    ...Array.from(raw.matchAll(PATH_SHAPE)).map((match) => match[0]),
    ...Array.from(raw.matchAll(FILE_HINT_SHAPE)).map((match) => match[0])
  ]);
  const negation = containsAny(normalized, NEGATION_TOKENS);
  const intentWhy =
    containsAny(normalized, WHY_PHRASES) ||
    /\bwhy\b/.test(normalized) ||
    /\bwhat role does\b/.test(normalized) ||
    /\bwhat does this\b.*\bdo\b/.test(normalized);
  const intentImpact = containsAny(normalized, IMPACT_PHRASES);
  const intentChanges = containsAny(normalized, CHANGES_PHRASES);
  const intentRename = containsAny(normalized, RENAME_PHRASES);
  const intentScope =
    containsAny(normalized, SCOPE_PHRASES) ||
    /\barchitecture\b|\bflow\b|\bwiring\b|\binteract\b|\bfit together\b/.test(normalized);
  const intentMemoryWakeup = containsAny(normalized, MEMORY_WAKEUP_PHRASES);
  const intentMemorySave = containsAny(normalized, MEMORY_SAVE_PHRASES);
  const intentMemorySearch = containsAny(normalized, MEMORY_SEARCH_PHRASES);
  const intentMemoryNavigate = containsAny(normalized, MEMORY_NAVIGATE_PHRASES);
  const intentMemoryTimeline = containsAny(normalized, MEMORY_TIMELINE_PHRASES);
  const intentLookup = containsAny(normalized, LOOKUP_PHRASES);
  const intentBatch = containsAny(normalized, BATCH_PHRASES);
  const intentResume = containsAny(normalized, RESUME_PHRASES);
  const intentMap = containsAny(normalized, ARTIFACT_MAP_PHRASES);
  const intentWiki = containsAny(normalized, ARTIFACT_WIKI_PHRASES);
  const intentContracts = containsAny(normalized, ARTIFACT_CONTRACT_PHRASES);
  const intentListRepos = containsAny(normalized, LIST_REPOS_PHRASES);
  const intentGroupQuery = containsAny(normalized, GROUP_QUERY_PHRASES);
  const intentGroupStatus = containsAny(normalized, GROUP_STATUS_PHRASES);
  const intentRead = scopeHints.length > 0 && containsAny(normalized, READ_WORDS);
  const intentEdit = scopeHints.length > 0 && containsAny(normalized, EDIT_WORDS);
  const intentWrite = scopeHints.length > 0 && containsAny(normalized, WRITE_WORDS);

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
    shellIntent,
    broadDiscovery,
    negation,
    intentWhy,
    intentImpact,
    intentChanges,
    intentRename,
    intentScope,
    intentMemoryWakeup,
    intentMemorySave,
    intentMemorySearch,
    intentMemoryNavigate,
    intentMemoryTimeline,
    intentLookup,
    intentBatch,
    intentRead,
    intentEdit,
    intentWrite,
    intentResume,
    intentMap,
    intentWiki,
    intentContracts,
    intentListRepos,
    intentGroupQuery,
    intentGroupStatus,
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
  if (signals.intentResume) {
    return { tool: "forge_resume", reason: "resume_prior_work" };
  }
  if (signals.intentMemorySave) {
    return { tool: "forge_memory_save", reason: "save_durable_memory" };
  }
  if (signals.intentMemoryWakeup) {
    return { tool: "forge_memory_wakeup", reason: "load_wakeup_memory" };
  }
  if (signals.intentMemoryNavigate) {
    return { tool: "forge_memory_navigate", reason: "navigate_memory_topology" };
  }
  if (signals.intentMemoryTimeline) {
    return { tool: "forge_memory_timeline", reason: "memory_timeline_request" };
  }
  if (signals.intentMemorySearch) {
    return { tool: "forge_memory_search", reason: "search_long_term_memory" };
  }
  if (signals.intentLookup) {
    return { tool: "forge_lookup", reason: "search_saved_research_output" };
  }
  if (signals.intentBatch) {
    return { tool: "forge_batch", reason: "log_or_test_research_request" };
  }
  if (signals.intentListRepos) {
    return { tool: "forge_list_repos", reason: "list_registered_repositories" };
  }
  if (signals.intentGroupQuery) {
    return { tool: "forge_group_query", reason: "query_repo_group" };
  }
  if (signals.intentGroupStatus) {
    return { tool: "forge_group_status", reason: "repo_group_status" };
  }
  if (signals.intentContracts) {
    return { tool: "forge_contracts", reason: "generate_contract_view" };
  }
  if (signals.intentWiki) {
    return { tool: "forge_wiki", reason: "generate_repo_wiki" };
  }
  if (signals.intentMap) {
    return { tool: "forge_map", reason: "generate_repo_map" };
  }
  if (signals.broadDiscovery) {
    return { tool: "forge_scan", reason: "broad_discovery_command" };
  }
  if (signals.exhaustive && !signals.negation && signals.scopeHints.length === 0) {
    return { tool: "forge_walk", reason: "exhaustive_whole_repo_request" };
  }
  if (signals.broadRepo && !signals.negation) {
    return { tool: "forge_understand", reason: "broad_repo_understanding" };
  }
  if (signals.intentRename) {
    return { tool: "forge_rename", reason: "coordinated_rename_request" };
  }
  if (signals.intentChanges) {
    return { tool: "forge_changes", reason: "git_change_mapping" };
  }
  if (signals.intentWhy) {
    return { tool: "forge_why", reason: "why_or_purpose_query" };
  }
  if (signals.intentImpact) {
    return { tool: "forge_impact", reason: "blast_radius_query" };
  }
  if (signals.exactSymbol) {
    return { tool: "forge_symbol", reason: "exact_symbol_query" };
  }
  if (signals.intentScope) {
    return { tool: "forge_scope", reason: "structure_or_relationship_query" };
  }
  if (signals.intentWrite) {
    return { tool: "forge_write", reason: "path_scoped_write_request" };
  }
  if (signals.intentEdit) {
    return { tool: "forge_edit", reason: "path_scoped_edit_request" };
  }
  if (signals.intentRead) {
    return { tool: "forge_read", reason: "path_scoped_read_request" };
  }
  if (signals.pinpoint) {
    return { tool: "forge_impact", reason: "pinpoint_blast_radius" };
  }
  if (signals.outputHeavy) {
    return { tool: "forge_batch", reason: "output_heavy_shell" };
  }
  if (signals.shellIntent) {
    return { tool: "forge_bash", reason: "repo_local_shell_request" };
  }
  return { tool: "forge_search", reason: "default_search" };
}
