#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { createContextForge } from "./contextforge.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "./session/runtime.js";

const SERVER_INFO = {
  name: "contextforge",
  version: "0.1.1"
};

const SERVER_INSTRUCTIONS = [
  "ContextForge is a Claude-first code-context server for repository search, architecture lookup, impact analysis, and session continuity.",
  "Use forge_start near the beginning of non-trivial tasks to establish paging and session state.",
  "Use forge_search for behavior or file lookup, forge_symbol for exact symbol names, forge_scope for architecture questions, forge_impact for blast radius, forge_why for repo-plus-session causality, and forge_resume or forge_session for continuity."
].join(" ");

const INDEX_REQUIRED_TOOLS = new Set([
  "forge_search",
  "forge_symbol",
  "forge_scope",
  "forge_impact",
  "forge_why",
  "forge_doctor"
]);

const LARGE_RESULT_TOOLS = new Set([
  "forge_scope",
  "forge_why",
  "forge_search",
  "forge_symbol",
  "forge_impact"
]);

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
      inputSchema: buildToolSchema(tool.parameters),
      _meta: LARGE_RESULT_TOOLS.has(tool.name)
        ? { "anthropic/maxResultSizeChars": 120000 }
        : undefined
    }, async (args = {}) => {
      if (INDEX_REQUIRED_TOOLS.has(tool.name)) {
        forge.indexRepository();
      }

      const result = await tool.execute(forge, args);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }],
        structuredContent: normalizeStructuredContent(result)
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
      return z.number().optional();
    case "auto | collapsed | traversal ?":
      return z.enum(["auto", "collapsed", "traversal"]).optional();
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

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
