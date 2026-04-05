#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import packageMeta from "../package.json" with { type: "json" };

import { createContextForge } from "./contextforge.js";
import { registerContextForgeResources } from "./mcp-resources.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "./session/runtime.js";

const SERVER_INFO = {
  name: "contextforge",
  version: packageMeta.version
};

const SERVER_INSTRUCTIONS = [
  "ContextForge is a Claude-first code-context server for repository search, architecture lookup, impact analysis, and session continuity.",
  "Use forge_start near the beginning of non-trivial tasks to establish paging and session state. On large repositories, forge_start may queue the eager full-repository prime in the background and return immediately; that is not a failure.",
  "Use forge_scan, forge_understand, or forge_walk first for broad prompts like understanding the whole repo or monorepo, going through every file or folder, mapping packages, or finding important files. forge_scan is the fastest first-pass repo map. forge_understand auto-escalates for exhaustive prompts, and forge_walk now performs a local full-repository audit for explicit every-file requests before returning a compact receipt-style digest. If forge_walk returns exhaustive_walk, treat it as authoritative: answer from it first and stop calling follow-up tools for the initial response. Do not call forge_read, forge_batch, forge_lookup, forge_search, or built-in Read/Bash/Grep after a successful exhaustive walk unless the user explicitly asks for drilldown or the audit says coverage is incomplete. If the user asks whether every file, the whole project, or every corner was read, answer yes only when audit.readCoverage.openedEveryRepositoryFile is true. If the user asks whether ContextForge fully remembers the repo in indexed memory, answer yes only when audit.indexedMemory.complete is true; otherwise say the local audit is complete but persistent indexed memory is still warming or deriving. Do not imply that every source line is sitting verbatim in active chat memory. For broad repo answers, keep the first response concise: prefer a short coverage verdict plus top-level architecture, major areas, and key entrypoints, ideally under 160 words. Avoid tables or long per-package expansions unless the user explicitly asks for more detail. Do not spawn Explore agents or manually read representative files for the initial whole-repo answer unless the user explicitly asks for a drilldown. For shell-heavy research, logs, diffs, test output, or multi-command discovery, prefer forge_batch first and use forge_lookup for follow-up questions so raw output stays in ContextForge's local research index instead of flooding chat. For compact file and shell operations inside the current repository, prefer forge_read, forge_write, forge_edit, and forge_bash over heavier built-in tool paths when they are sufficient. Prefer forge_why for prompts like `why does this file matter`, `what is this for`, or `why is this important`; forge_impact for `what breaks if I change X`; forge_changes for `what changed on this branch` or `summarize the diff`; forge_rename for rename requests; forge_symbol for `where is function/class X`; forge_search for `find where behavior Y is implemented`; forge_scope for `how is this area structured`; forge_map, forge_contracts, or forge_wiki for generated architecture artifacts; forge_resume or forge_session for continuity; and forge_list_repos, forge_group_query, or forge_group_status for multi-repo registry work. Read ContextForge resources when you need structured overviews of the repo, areas, flows, schema, groups, or generated artifacts."
].join(" ");

export async function startMcpServer(argv = process.argv.slice(2)) {
  const config = parseServerArgs(argv);
  const rootDir = path.resolve(config.rootDir ?? process.cwd());
  const resolvedSessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: config.sessionId,
    preferActive: config.useActiveSession
  });
  const forge = createContextForge(rootDir, resolvedSessionId ? { sessionId: resolvedSessionId } : {});

  if (config.rememberSession) {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "mcp",
      command: "mcp-stdio"
    });
  }

  const server = new McpServer(SERVER_INFO, {
    capabilities: { logging: {}, resources: {} },
    instructions: SERVER_INSTRUCTIONS
  });

  for (const tool of Object.values(TOOL_REGISTRY)) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: buildToolSchema(tool.parameters)
    }, async (args = {}) => {
      const result = await tool.execute(forge, args);
      const payload = formatToolResult(forge, tool.name, result);
      return {
        content: [{
          type: "text",
          text: payload.text
        }],
        structuredContent: payload.structured
      };
    });
  }

  registerContextForgeResources(server, forge);

  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
  } catch (error) {
    forge.close();
    throw error;
  }

  const cleanup = async () => {
    try {
      await server.close();
    } finally {
      forge.close();
    }
  };

  process.once("SIGINT", () => {
    cleanup().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    cleanup().finally(() => process.exit(0));
  });
}

function parseServerArgs(args) {
  const config = {
    rootDir: process.env.CONTEXTFORGE_ROOT ?? null,
    sessionId: process.env.CONTEXTFORGE_SESSION_ID ?? null,
    useActiveSession: truthy(process.env.CONTEXTFORGE_USE_ACTIVE_SESSION),
    rememberSession: process.env.CONTEXTFORGE_REMEMBER_SESSION == null
      ? true
      : truthy(process.env.CONTEXTFORGE_REMEMBER_SESSION)
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--root") {
      config.rootDir = args[index + 1] ?? config.rootDir;
      index += 1;
      continue;
    }

    if (value.startsWith("--root=")) {
      config.rootDir = value.slice("--root=".length);
      continue;
    }

    if (value === "--session-id") {
      config.sessionId = args[index + 1] ?? config.sessionId;
      index += 1;
      continue;
    }

    if (value.startsWith("--session-id=")) {
      config.sessionId = value.slice("--session-id=".length);
      continue;
    }

    if (value === "--use-active-session") {
      config.useActiveSession = true;
      continue;
    }

    if (value === "--no-use-active-session") {
      config.useActiveSession = false;
      continue;
    }

    if (value === "--remember-session") {
      config.rememberSession = true;
      continue;
    }

    if (value === "--no-remember-session") {
      config.rememberSession = false;
      continue;
    }
  }

  return config;
}

function truthy(value) {
  return value === "1" || value === "true" || value === "yes";
}

function buildToolSchema(parameters = {}) {
  const shape = {};

  for (const [name, descriptor] of Object.entries(parameters)) {
    shape[name] = schemaForDescriptor(descriptor);
  }

  return shape;
}

function schemaForDescriptor(descriptor) {
  const normalized = String(descriptor ?? "").trim();

  switch (normalized) {
    case "string":
      return z.string();
    case "string?":
      return z.string().optional();
    case "string[]":
      return z.array(z.string());
    case "string[]?":
      return z.array(z.string()).optional();
    case "number":
      return z.number();
    case "number?":
      return z.union([z.number(), z.string()]).optional();
    case "boolean":
      return z.union([z.boolean(), z.string()]);
    case "boolean?":
      return z.union([z.boolean(), z.string()]).optional();
    case "auto | collapsed | traversal ?":
      return z.string().optional();
    case "string | 'list'":
      return z.union([z.string(), z.literal("list")]).optional();
    default:
      return z.any().optional();
  }
}

function normalizeStructuredContent(result) {
  if (result == null) {
    return { result: null };
  }

  if (Array.isArray(result)) {
    return { items: result };
  }

  if (typeof result === "object") {
    return result;
  }

  return { result };
}

function formatToolResult(forge, toolName, result) {
  const normalized = normalizeStructuredContent(result);
  const compact = compactToolResult(toolName, normalized);
  const rawSerialized = JSON.stringify(normalized);
  const payloadWithSavings = attachContextSavings(compact, rawSerialized);
  const text = JSON.stringify(payloadWithSavings);
  forge.recordToolReceipt?.({
    toolName,
    rawSize: Buffer.byteLength(rawSerialized, "utf8"),
    deliveredSize: Buffer.byteLength(text, "utf8")
  });
  return {
    text,
    structured: payloadWithSavings
  };
}

function attachContextSavings(payload, rawSerialized) {
  const basePayload = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : { result: payload };
  let provisional = {
    ...basePayload,
    contextSavings: {
      rawBytes: 0,
      deliveredBytes: 0,
      savedBytes: 0,
      reductionPct: 0,
      rawTokens: 0,
      deliveredTokens: 0,
      savedTokens: 0,
      display: "0 B -> 0 B"
    }
  };
  let deliveredSerialized = JSON.stringify(provisional);
  provisional = {
    ...basePayload,
    contextSavings: buildContextSavings(rawSerialized, deliveredSerialized)
  };
  deliveredSerialized = JSON.stringify(provisional);
  return {
    ...basePayload,
    contextSavings: buildContextSavings(rawSerialized, deliveredSerialized)
  };
}

function buildContextSavings(rawSerialized, deliveredSerialized) {
  const rawBytes = Buffer.byteLength(String(rawSerialized ?? ""), "utf8");
  const deliveredBytes = Buffer.byteLength(String(deliveredSerialized ?? ""), "utf8");
  const savedBytes = Math.max(0, rawBytes - deliveredBytes);
  const rawTokens = estimateTokens(rawBytes);
  const deliveredTokens = estimateTokens(deliveredBytes);
  const savedTokens = Math.max(0, rawTokens - deliveredTokens);
  const reductionPct = rawBytes > 0
    ? Number(((savedBytes / rawBytes) * 100).toFixed(1))
    : 0;

  return {
    rawBytes,
    deliveredBytes,
    savedBytes,
    reductionPct,
    rawTokens,
    deliveredTokens,
    savedTokens,
    display: `${formatBytes(rawBytes)} -> ${formatBytes(deliveredBytes)} (${reductionPct}% saved)`
  };
}

function estimateTokens(byteCount) {
  return Math.max(0, Math.ceil((Number(byteCount) || 0) / 4));
}

function formatBytes(byteCount) {
  const value = Number(byteCount) || 0;
  if (value < 1024) {
    return `${value} B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${stripTrailingZeros(kib.toFixed(kib >= 100 ? 0 : kib >= 10 ? 1 : 2))} KB`;
  }
  const mib = kib / 1024;
  return `${stripTrailingZeros(mib.toFixed(mib >= 100 ? 0 : mib >= 10 ? 1 : 2))} MB`;
}

function stripTrailingZeros(value) {
  return String(value).replace(/\.0+$|(\.\d*[1-9])0+$/u, "$1");
}

function compactToolResult(toolName, result) {
  if (toolName === "forge_scan" || toolName === "forge_understand" || toolName === "forge_walk") {
    const mode = result?.mode;
    if (mode === "inventory_first" || mode === "inventory_walk" || mode === "exhaustive_walk") {
      return compactWalkResult(result);
    }
  }

  if (toolName === "forge_batch" || toolName === "forge_lookup") {
    return compactResearchResult(result);
  }

  return result;
}

function compactWalkResult(result) {
  const mode = result?.mode ?? null;
  const topLevel = Array.isArray(result.topLevel)
    ? result.topLevel.slice(0, 6).map((entry) => ({
        path: entry.path,
        fileCount: entry.fileCount
      }))
    : result.topLevel;
  const majorAreas = buildMajorAreas(result);
  const entrypoints = Array.isArray(result.entrypoints)
    ? result.entrypoints.slice(0, 8).map((entry) => entry.path)
    : result.entrypoints;
  const importantFiles = Array.isArray(result.importantFiles)
    ? result.importantFiles.slice(0, 8).map((entry) => entry.path)
    : result.importantFiles;
  const rootFiles = Array.isArray(result.rootFiles) ? result.rootFiles.slice(0, 6) : result.rootFiles;
  const packages = Array.isArray(result.packages)
    ? result.packages.slice(0, 6).map((pkg) => ({
        path: pkg.path,
        name: pkg.name,
        description: pkg.description
      }))
    : result.packages;
  const audit = compactAudit(result.audit);

  return {
    query: result.query,
    mode: result.mode,
    summary: result.summary,
    guidance: result.guidance,
    coverage: result.coverage,
    audit,
    topLevel,
    majorAreas,
    packages,
    rootFiles,
    entrypoints,
    importantFiles,
    responsePolicy: {
      delivery: "receipt_first",
      detailsStoredLocally: true,
      expandOnDemand: true,
      truncatedForMcp: true,
      firstAnswerWordLimit: 160,
      initialAnswerReady: mode === "exhaustive_walk",
      noManualFollowupReads: mode === "exhaustive_walk",
      initialAnswerShouldUseAuditOnly: mode === "exhaustive_walk",
      forbidFollowupTools: mode === "exhaustive_walk"
        ? ["forge_read", "forge_batch", "forge_lookup", "forge_search", "Read", "Bash", "Grep"]
        : [],
      preferredAnswerShape: [
        "coverage_verdict",
        "top_level_architecture",
        "major_areas",
        "key_entrypoints",
        "important_files"
      ]
    },
    detailCounts: {
      topLevelCount: Array.isArray(result.topLevel) ? result.topLevel.length : 0,
      packageCount: Array.isArray(result.packages) ? result.packages.length : 0,
      packageSectionCount: Array.isArray(result.packageSections) ? result.packageSections.length : 0,
      directorySectionCount: Array.isArray(result.directorySections) ? result.directorySections.length : 0,
      importantFileCount: Array.isArray(result.importantFiles) ? result.importantFiles.length : 0
    }
  };
}

function compactResearchResult(result) {
  return {
    sourceId: result.sourceId ?? null,
    label: result.label ?? null,
    cwd: result.cwd ?? null,
    summary: result.summary,
    guidance: result.guidance,
    commands: Array.isArray(result.commands)
      ? result.commands.map((command) => ({
          command: command.command,
          exitCode: command.exitCode,
          timedOut: command.timedOut,
          stdoutChars: command.stdoutChars,
          stderrChars: command.stderrChars
        }))
      : undefined,
    indexedSections: result.indexedSections ?? null,
    queries: Array.isArray(result.queries)
      ? result.queries.map((entry) => ({
          query: entry.query,
          matches: Array.isArray(entry.matches)
            ? entry.matches.slice(0, 3).map((match) => ({
                title: match.title,
                label: match.label,
                preview: match.preview,
                score: match.score
              }))
            : []
        }))
      : undefined,
    responsePolicy: {
      delivery: "receipt_first",
      rawOutputStoredLocally: true,
      expandOnDemand: true,
      firstAnswerWordLimit: 180
    }
  };
}

function compactAudit(audit) {
  if (!audit) {
    return audit;
  }

  return {
    fileCountInspected: audit.fileCountInspected,
    textFileCount: audit.textFileCount,
    binaryFileCount: audit.binaryFileCount,
    generatedFileCount: audit.generatedFileCount,
    vendorFileCount: audit.vendorFileCount,
    totalLineCount: audit.totalLineCount,
    totalByteCount: audit.totalByteCount,
    readCoverage: audit.readCoverage
      ? {
          openedEveryRepositoryFile: audit.readCoverage.openedEveryRepositoryFile,
          readFullTextBodies: audit.readCoverage.readFullTextBodies,
          scannedBinaryAssets: audit.readCoverage.scannedBinaryAssets,
          fullTextLinesRead: audit.readCoverage.fullTextLinesRead,
          canAnswerYesToWholeProjectRead: audit.readCoverage.canAnswerYesToWholeProjectRead
        }
      : audit.readCoverage,
    indexedMemory: audit.indexedMemory
      ? {
          status: audit.indexedMemory.status,
          complete: audit.indexedMemory.complete,
          filesTotal: audit.indexedMemory.filesTotal,
          filesIndexed: audit.indexedMemory.filesIndexed,
          fullTextBodiesStored: audit.indexedMemory.fullTextBodiesStored,
          binaryAssetsScanned: audit.indexedMemory.binaryAssetsScanned,
          indexedLineCount: audit.indexedMemory.indexedLineCount,
          canAnswerYesToRememberingWholeProject: audit.indexedMemory.canAnswerYesToRememberingWholeProject
        }
      : audit.indexedMemory,
    roleBreakdown: Array.isArray(audit.roleBreakdown) ? audit.roleBreakdown.slice(0, 4) : audit.roleBreakdown
  };
}

function buildMajorAreas(result) {
  const items = [];
  const seen = new Set();

  if (Array.isArray(result.packageSections)) {
    for (const section of result.packageSections.slice(0, 6)) {
      const key = `package:${section.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        path: section.path,
        name: section.name ?? section.path,
        purpose: section.purpose ?? section.description ?? "workspace package",
        fileCount: section.fileCount ?? section.auditedFiles ?? 0
      });
    }
  }

  if (Array.isArray(result.directorySections)) {
    for (const section of result.directorySections.slice(0, 6)) {
      const key = `dir:${section.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        path: section.path,
        name: section.name ?? section.path,
        purpose: section.purpose ?? section.description ?? "repository area",
        fileCount: section.fileCount ?? section.auditedFiles ?? 0
      });
    }
  }

  return items.slice(0, 8);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
