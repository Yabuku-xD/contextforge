#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import packageMeta from "../package.json" with { type: "json" };

import { createContextForge } from "./contextforge.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "./session/runtime.js";

const SERVER_INFO = {
  name: "contextforge",
  version: packageMeta.version
};

const SERVER_INSTRUCTIONS = [
  "ContextForge is a Claude-first code-context server for repository search, architecture lookup, impact analysis, and session continuity.",
  "Use forge_start near the beginning of non-trivial tasks to establish paging and session state. On large repositories, forge_start may queue the eager full-repository prime in the background and return immediately; that is not a failure.",
  "Use forge_scan, forge_understand, or forge_walk first for broad prompts like understanding the whole repo or monorepo, going through every file or folder, mapping packages, or finding important files. forge_scan is the fastest first-pass repo map. forge_understand auto-escalates for exhaustive prompts, and forge_walk now performs a local full-repository audit for explicit every-file requests before returning a compact package-by-package and folder-by-folder digest. If forge_walk returns exhaustive_walk, treat it as authoritative: answer from it first. If the user asks whether every file, the whole project, or every corner was read, answer yes only when audit.readCoverage.openedEveryRepositoryFile is true. If the user asks whether ContextForge fully remembers the repo in indexed memory, answer yes only when audit.indexedMemory.complete is true; otherwise say the local audit is complete but persistent indexed memory is still warming or deriving. Do not imply that every source line is sitting verbatim in active chat memory. Do not spawn Explore agents for the initial whole-repo answer unless the user explicitly asks for a manual drilldown. For compact file and shell operations inside the current repository, prefer forge_read, forge_write, forge_edit, and forge_bash over heavier built-in tool paths when they are sufficient. Use forge_search for behavior or file lookup, forge_symbol for exact symbol names, forge_scope for architecture questions, forge_impact for blast radius, forge_why for repo-plus-session causality, and forge_resume or forge_session for continuity."
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
    capabilities: { logging: {} },
    instructions: SERVER_INSTRUCTIONS
  });

  for (const tool of Object.values(TOOL_REGISTRY)) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: buildToolSchema(tool.parameters)
    }, async (args = {}) => {
      const result = await tool.execute(forge, args);
      const payload = formatToolResult(tool.name, result);
      return {
        content: [{
          type: "text",
          text: payload.text
        }],
        structuredContent: payload.structured
      };
    });
  }

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

function formatToolResult(toolName, result) {
  const normalized = normalizeStructuredContent(result);
  const compact = compactToolResult(toolName, normalized);
  return {
    text: JSON.stringify(compact, null, 2),
    structured: compact
  };
}

function compactToolResult(toolName, result) {
  if (toolName === "forge_walk" || toolName === "forge_understand") {
    const mode = result?.mode;
    if (mode === "exhaustive_walk" || mode === "inventory_walk") {
      return compactWalkResult(result);
    }
  }

  return result;
}

function compactWalkResult(result) {
  const topLevel = Array.isArray(result.topLevel)
    ? result.topLevel.slice(0, 10).map((entry) => ({
        path: entry.path,
        fileCount: entry.fileCount,
        languages: entry.languages
      }))
    : result.topLevel;
  const packages = Array.isArray(result.packages)
    ? result.packages.slice(0, 10).map((pkg) => ({
        path: pkg.path,
        name: pkg.name,
        description: pkg.description,
        version: pkg.version
      }))
    : result.packages;
  const rootFiles = Array.isArray(result.rootFiles) ? result.rootFiles.slice(0, 10) : result.rootFiles;
  const entrypoints = Array.isArray(result.entrypoints)
    ? result.entrypoints.slice(0, 10).map((entry) => ({
        path: entry.path,
        reason: entry.reason,
        score: entry.score
      }))
    : result.entrypoints;
  const architecture = Array.isArray(result.architecture)
    ? result.architecture.slice(0, 10).map((entry) => ({
        label: entry.label,
        score: entry.score,
        summary: entry.summary
      }))
    : result.architecture;
  const importantFiles = Array.isArray(result.importantFiles)
    ? result.importantFiles.slice(0, 10).map((entry) => ({
        path: entry.path,
        score: entry.score,
        reasons: entry.reasons
      }))
    : result.importantFiles;
  const packageSections = sliceWalkSections(result.packageSections, 6);
  const directorySections = sliceWalkSections(result.directorySections, 6);

  return {
    ...result,
    topLevel,
    packages,
    rootFiles,
    entrypoints,
    architecture,
    importantFiles,
    packageSections,
    directorySections,
    audit: result.audit
      ? {
          ...result.audit,
          roleBreakdown: Array.isArray(result.audit.roleBreakdown) ? result.audit.roleBreakdown.slice(0, 6) : result.audit.roleBreakdown,
          binarySamples: Array.isArray(result.audit.binarySamples) ? result.audit.binarySamples.slice(0, 6) : result.audit.binarySamples
        }
      : result.audit,
    responseWindow: {
      topLevelReturned: Array.isArray(topLevel) ? topLevel.length : 0,
      packagesReturned: Array.isArray(packages) ? packages.length : 0,
      packageSectionsReturned: Array.isArray(packageSections) ? packageSections.length : 0,
      directorySectionsReturned: Array.isArray(directorySections) ? directorySections.length : 0,
      importantFilesReturned: Array.isArray(importantFiles) ? importantFiles.length : 0,
      truncatedForMcp: true
    }
  };
}

function sliceWalkSections(sections, limit) {
  if (!Array.isArray(sections)) {
    return sections;
  }

  return sections.slice(0, limit).map((section) => ({
    path: section.path,
    name: section.name,
    description: section.description,
    purpose: section.purpose,
    fileCount: section.fileCount,
    auditedFiles: section.auditedFiles,
    textFiles: section.textFiles,
    binaryFiles: section.binaryFiles,
    languages: section.languages,
    directFiles: Array.isArray(section.directFiles) ? section.directFiles.slice(0, 4) : section.directFiles,
    entrypoints: Array.isArray(section.entrypoints)
      ? section.entrypoints.slice(0, 4).map((entry) => ({
          path: entry.path,
          reason: entry.reason,
          score: entry.score
        }))
      : section.entrypoints,
    subdirectories: Array.isArray(section.subdirectories)
      ? section.subdirectories.slice(0, 4).map((entry) => ({
          path: entry.path,
          fileCount: entry.fileCount,
          purpose: entry.purpose
        }))
      : section.subdirectories,
    representativeFiles: Array.isArray(section.representativeFiles)
      ? section.representativeFiles.slice(0, 4).map((entry) => ({
          path: entry.path,
          score: entry.score,
          reasons: entry.reasons
        }))
      : section.representativeFiles,
    notableFiles: Array.isArray(section.notableFiles) ? section.notableFiles.slice(0, 4) : section.notableFiles,
    workspacePackages: Array.isArray(section.workspacePackages)
      ? section.workspacePackages.slice(0, 4).map((entry) => ({
          path: entry.path,
          name: entry.name,
          description: entry.description
        }))
      : section.workspacePackages,
    topLevelSamples: Array.isArray(section.topLevelSamples)
      ? section.topLevelSamples.slice(0, 4).map((entry) => ({
          path: entry.path,
          fileCount: entry.fileCount,
          purpose: entry.purpose
        }))
      : section.topLevelSamples,
    samples: Array.isArray(section.samples) ? section.samples.slice(0, 4) : section.samples,
    roleBreakdown: Array.isArray(section.roleBreakdown) ? section.roleBreakdown.slice(0, 6) : section.roleBreakdown
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
