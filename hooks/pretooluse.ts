#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { openDatabase, isDatabaseLockError } from "../src/storage/db.js";
import { readActiveSession } from "../src/session/runtime.js";
import { extractQuerySignals } from "../src/router/query-signals.js";

const RECENT_EXHAUSTIVE_WALK_WINDOW_MS = 5 * 60 * 1000;

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

function isWholeRepoRequest(text) {
  const signals = extractQuerySignals(text);
  if (signals.negation) return false;
  return signals.broadRepo || signals.exhaustive;
}

function isBroadDiscoveryCommand(command) {
  return extractQuerySignals(command).broadDiscovery;
}

function isOutputHeavyCommand(command) {
  return extractQuerySignals(command).outputHeavy;
}

function formatContext(additionalContext) {
  return {
    continue: true,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext
    }
  };
}

function formatDeny(reason) {
  return {
    continue: false,
    suppressOutput: false,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}

function formatPostAuditDeny(reason) {
  return formatDeny(reason);
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

const DEFAULT_FILE_OP_ROUTES = {
  Read: {
    forgeTool: "forge_read",
    note: "forge_read returns compact excerpts and directory listings with built-in paging."
  },
  Write: {
    forgeTool: "forge_write",
    note: "forge_write is repo-aware and keeps session state in sync."
  },
  Edit: {
    forgeTool: "forge_edit",
    note: "forge_edit performs exact in-file replacement with coordinated rename awareness."
  },
  Bash: {
    forgeTool: "forge_bash",
    note: "forge_bash runs repo-local commands and keeps output compact; use forge_batch for shell-heavy research."
  },
  Grep: {
    forgeTool: "forge_search",
    note: "forge_search is hybrid BM25+vector+graph retrieval. Use forge_symbol for exact identifiers."
  }
};

function createFileOpRoutingGuidance(toolName) {
  const route = DEFAULT_FILE_OP_ROUTES[toolName];
  if (!route) return null;
  return [
    "<contextforge_fileop>",
    `ContextForge is the default path for ${toolName} in this repository.`,
    `Prefer ${route.forgeTool} first — ${route.note}`,
    "Only fall back to the built-in tool when ContextForge is unavailable, permission-denied, or the operation must run outside the repository boundary.",
    `Current tool: ${toolName}. Use it only if ${route.forgeTool} is insufficient for the task.`,
    "</contextforge_fileop>"
  ].join("\n");
}

function loadRecentExhaustiveWalkState(rootDir = process.cwd()) {
  const activeSession = readActiveSession(rootDir);
  if (!activeSession?.sessionId) {
    return null;
  }

  const dbPath = path.join(rootDir, ".contextforge", "contextforge.db");
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  let db = null;
  try {
    db = openDatabase(rootDir);
    const row = db.prepare(`
      SELECT payload_json AS payloadJson, created_at AS createdAt
      FROM session_events
      WHERE session_id = ? AND event_type = 'walk'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(activeSession.sessionId);
    if (!row?.payloadJson) {
      return null;
    }

    const payload = JSON.parse(row.payloadJson);
    const ageMs = Math.max(0, Date.now() - Number(row.createdAt ?? 0));
    const exhaustive = payload?.routedMode === "exhaustive_walk" && Number(payload?.auditedFileCount ?? 0) > 0;
    if (!exhaustive || ageMs > RECENT_EXHAUSTIVE_WALK_WINDOW_MS) {
      return null;
    }

    return {
      sessionId: activeSession.sessionId,
      ageMs,
      auditedFileCount: Number(payload?.auditedFileCount ?? 0),
      auditedTextFileCount: Number(payload?.auditedTextFileCount ?? 0)
    };
  } catch (error) {
    if (!isDatabaseLockError(error)) {
      return null;
    }
    return null;
  } finally {
    db?.close?.();
  }
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
const recentExhaustiveWalk = loadRecentExhaustiveWalkState(process.cwd());

let response = null;

if ((toolName === "Agent" || toolName === "Task") && isWholeRepoRequest(toolText)) {
  response = formatDeny(
    "Use ContextForge first for whole-repository understanding. Run forge_start, then forge_scan, forge_understand, or forge_walk before spawning subagents."
  );
} else if (recentExhaustiveWalk && toolName === "Read") {
  response = formatPostAuditDeny(
    `ContextForge already completed an exhaustive repository walk in this session and opened ${recentExhaustiveWalk.auditedFileCount} files locally. Answer from that audit first instead of manually reading representative files. Only drill down if the user explicitly asks for a specific file or function, and prefer forge_read for that targeted follow-up.`
  );
} else if (recentExhaustiveWalk && toolName === "Grep") {
  response = formatPostAuditDeny(
    `ContextForge already completed an exhaustive repository walk in this session and read ${recentExhaustiveWalk.auditedTextFileCount} text bodies locally. Use forge_search or forge_symbol instead of broad follow-up grep, and only drill down if the user explicitly asks for it.`
  );
} else if (toolName === "Bash") {
  const command = normalizeText(toolInput.command ?? toolInput);
  if (recentExhaustiveWalk && (isBroadDiscoveryCommand(command) || isOutputHeavyCommand(command))) {
    response = formatPostAuditDeny(
      `ContextForge already completed an exhaustive repository walk in this session. Do not resume broad repository crawling or replay large command output after the audit. Answer from the audit first; if the user explicitly asks for shell-backed drilldown, prefer forge_batch or forge_lookup.`
    );
  } else if (isBroadDiscoveryCommand(command)) {
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

// Default file-op routing: if no more specific branch already fired, nudge
// the agent toward the ContextForge equivalent of Read / Write / Edit / Bash /
// Grep so the plugin — not the user's CLAUDE.md — enforces the preference.
if (!response) {
  const defaultGuidance = createFileOpRoutingGuidance(toolName);
  if (defaultGuidance) {
    response = formatContext(defaultGuidance);
  }
}

if (response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
