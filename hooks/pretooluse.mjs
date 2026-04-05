#!/usr/bin/env node

const WHOLE_REPO_PATTERNS = [
  /\bevery\s+single\s+file\b/i,
  /\bwhole\s+repo(?:sitory)?\b/i,
  /\bentire\s+repo(?:sitory)?\b/i,
  /\bfull\s+repo(?:sitory)?\b/i,
  /\bwhole\s+project\b/i,
  /\bentire\s+project\b/i,
  /\bmonorepo\b/i,
  /\bproject\s+structure\b/i,
  /\barchitecture\s+overview\b/i,
  /\bgo\s+through\s+the\s+repo\b/i,
  /\bpackages?\b/i,
  /\bfolders?\b/i,
  /\bsubfolders?\b/i,
  /\bwalk\s+the\s+repo\b/i
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

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isWholeRepoRequest(text) {
  return matchesAny(text, WHOLE_REPO_PATTERNS);
}

function isBroadDiscoveryCommand(command) {
  return matchesAny(command, BROAD_DISCOVERY_COMMANDS);
}

function isOutputHeavyCommand(command) {
  return matchesAny(command, OUTPUT_HEAVY_COMMANDS);
}

function formatContext(additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext
    }
  };
}

function formatDeny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

function createRepoRoutingGuidance(toolName) {
  return [
    "<contextforge_pretooluse>",
    "ContextForge is the preferred path for repository-wide discovery and architecture work.",
    "For broad repo understanding, use forge_start first, then forge_scan, forge_understand, or forge_walk instead of noisy manual exploration.",
    "Keep the first whole-repo answer compact: coverage verdict, top-level architecture, major areas, and key entrypoints only.",
    "If ContextForge is unavailable or permission-denied, fall back to narrower built-in reads instead of broad recursive crawling.",
    `Current tool: ${toolName}. Use it only if ContextForge is insufficient for the task.`,
    "</contextforge_pretooluse>"
  ].join("\n");
}

function createResearchRoutingGuidance(toolName) {
  return [
    "<contextforge_research>",
    "ContextForge is the preferred path for shell-heavy research and large command output.",
    "Use forge_batch to run commands and keep raw output in ContextForge's local research index.",
    "Use forge_lookup for follow-up questions instead of replaying logs or diffs into chat.",
    "Keep the first answer short: receipt, key findings, and next step only.",
    "If ContextForge is unavailable or permission-denied, use narrower built-in commands and avoid dumping large raw output into chat.",
    `Current tool: ${toolName}. Use it only if ContextForge is insufficient for the task.`,
    "</contextforge_research>"
  ].join("\n");
}

const rawInput = await new Promise((resolve) => {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
  });
  process.stdin.on("end", () => resolve(buffer));
  process.stdin.resume();
});

const input = safeParseJson(rawInput);
const toolName = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};
const toolText = normalizeText(toolInput);

let response = null;

if ((toolName === "Agent" || toolName === "Task") && isWholeRepoRequest(toolText)) {
  response = formatDeny(
    "Use ContextForge first for whole-repository understanding. Run forge_start, then forge_scan, forge_understand, or forge_walk before spawning subagents."
  );
} else if (toolName === "Bash") {
  const command = normalizeText(toolInput.command ?? toolInput);
  if (isBroadDiscoveryCommand(command)) {
    response = formatContext(createRepoRoutingGuidance(toolName));
  } else if (isOutputHeavyCommand(command)) {
    response = formatContext(createResearchRoutingGuidance(toolName));
  } else if (isWholeRepoRequest(command)) {
    response = formatContext(createRepoRoutingGuidance(toolName));
  }
} else if (toolName === "Read" || toolName === "Grep" || toolName === "WebFetch") {
  if (isWholeRepoRequest(toolText)) {
    response = formatContext(createRepoRoutingGuidance(toolName));
  } else if (toolName === "Grep" && isOutputHeavyCommand(toolText)) {
    response = formatContext(createResearchRoutingGuidance(toolName));
  }
}

if (response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
