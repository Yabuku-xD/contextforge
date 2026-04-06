import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { TOOL_REGISTRY } from "../tools/registry.js";
import { ensureDir, exists, readText, writeText } from "../utils/fs.js";

const DEFAULT_SERVER_NAME = "contextforge";
const MCP_SERVER_PATH = fileURLToPath(new URL("../mcp-server.js", import.meta.url));
const DEFAULT_PLUGIN_PREFIX = "mcp__plugin_contextforge_contextforge__";
const STRONG_PROJECT_MARKERS = [".claude", ".mcp.json", ".git"];
const WEAK_PROJECT_MARKERS = ["package.json", "README.md", "pyproject.toml", "Cargo.toml", "go.mod"];
const MUTATING_TOOL_NAMES = new Set([
  "forge_batch",
  "forge_write",
  "forge_edit",
  "forge_bash",
  "forge_rename",
  "forge_map",
  "forge_contracts",
  "forge_wiki"
]);

export function installClaudeCodeProject(targetDir = process.cwd(), options = {}) {
  const resolvedTarget = path.resolve(targetDir);
  const configPath = path.join(resolvedTarget, ".mcp.json");
  const serverName = options.serverName ?? DEFAULT_SERVER_NAME;

  const config = exists(configPath)
    ? parseConfig(configPath)
    : { mcpServers: {} };

  if (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers)) {
    config.mcpServers = {};
  }

  const nextEntry = buildClaudeCodeServerEntry(options.rootArg ?? ".");
  const previousEntry = config.mcpServers[serverName];
  config.mcpServers[serverName] = nextEntry;

  writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const permissions = mergeClaudeCodePermissions(resolvedTarget, {
    serverName,
    allowMutations: options.allowMutations,
    dontAsk: options.dontAsk
  });

  return {
    targetDir: resolvedTarget,
    configPath,
    permissionsPath: permissions.configPath,
    serverName,
    serverPath: MCP_SERVER_PATH,
    status: previousEntry ? (sameEntry(previousEntry, nextEntry) ? "unchanged" : "updated") : "created",
    permissionsStatus: permissions.status,
    allowedTools: permissions.allowedTools,
    mutatingToolsAllowed: permissions.mutatingToolsAllowed,
    defaultMode: permissions.defaultMode
  };
}

export function buildClaudeCodeServerEntry(rootArg = ".") {
  return {
    command: "node",
    args: [MCP_SERVER_PATH, "--root", rootArg],
    env: {
      CONTEXTFORGE_USE_ACTIVE_SESSION: "1"
    }
  };
}

function parseConfig(configPath) {
  try {
    return JSON.parse(readText(configPath));
  } catch (error) {
    throw new Error(`Unable to parse ${configPath}: ${error.message}`);
  }
}

function sameEntry(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function mergeClaudeCodePermissions(targetDir = process.cwd(), options = {}) {
  const resolvedTarget = path.resolve(targetDir);
  const settingsDir = path.join(resolvedTarget, ".claude");
  const configPath = path.join(settingsDir, "settings.local.json");
  const serverName = options.serverName ?? DEFAULT_SERVER_NAME;
  const existedBefore = exists(configPath);
  const localPrefix = `mcp__${sanitizeServerName(serverName)}__`;
  const pluginPrefix = DEFAULT_PLUGIN_PREFIX;

  ensureDir(settingsDir);

  const config = exists(configPath)
    ? parseConfig(configPath)
    : {};

  if (!config.permissions || typeof config.permissions !== "object" || Array.isArray(config.permissions)) {
    config.permissions = {};
  }

  if (!Array.isArray(config.permissions.allow)) {
    config.permissions.allow = [];
  }

  if (options.dontAsk && !config.permissions.defaultMode) {
    config.permissions.defaultMode = "dontAsk";
  }

  const previousAllow = new Set(config.permissions.allow);
  const nextAllow = new Set(config.permissions.allow.filter((permission) =>
    !String(permission).startsWith(localPrefix) && !String(permission).startsWith(pluginPrefix)));
  for (const permission of buildAllowedPermissionEntries(serverName, {
    allowMutations: options.allowMutations
  })) {
    nextAllow.add(permission);
  }

  config.permissions.allow = [...nextAllow].sort();
  writeText(configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    configPath,
    status: previousAllow.size === nextAllow.size ? "unchanged" : existedBefore ? "updated" : "created",
    allowedTools: [...nextAllow].length,
    mutatingToolsAllowed: Boolean(options.allowMutations),
    defaultMode: config.permissions.defaultMode ?? null
  };
}

export function syncClaudeCodePermissions(startDir = process.cwd(), options = {}) {
  const targets = findClaudeProjectTargets(startDir);
  return targets.map((targetDir) => mergeClaudeCodePermissions(targetDir, options));
}

export function findClaudeProjectTargets(startDir = process.cwd()) {
  const resolvedStart = path.resolve(startDir);
  if (!exists(resolvedStart)) {
    return [];
  }

  const homeDir = path.resolve(os.homedir());
  let current = resolvedStart;
  let strongTarget = null;
  let weakTarget = null;

  while (current && current !== homeDir) {
    if (!strongTarget && hasProjectMarker(current, STRONG_PROJECT_MARKERS)) {
      strongTarget = current;
      break;
    }

    if (!weakTarget && hasProjectMarker(current, WEAK_PROJECT_MARKERS)) {
      weakTarget = current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (strongTarget) {
    return [strongTarget];
  }

  if (weakTarget) {
    return [weakTarget];
  }

  return [];
}

function buildAllowedPermissionEntries(serverName, options = {}) {
  const localPrefix = `mcp__${sanitizeServerName(serverName)}__`;
  const toolNames = Object.values(TOOL_REGISTRY)
    .map((tool) => tool.name)
    .filter((toolName) => options.allowMutations || !MUTATING_TOOL_NAMES.has(toolName));
  const permissions = new Set();

  for (const toolName of toolNames) {
    permissions.add(`${localPrefix}${toolName}`);
    permissions.add(`${DEFAULT_PLUGIN_PREFIX}${toolName}`);
  }

  return [...permissions];
}

function hasProjectMarker(targetDir, markers) {
  return markers.some((entry) => exists(path.join(targetDir, entry)));
}

function sanitizeServerName(serverName) {
  return String(serverName ?? DEFAULT_SERVER_NAME)
    .trim()
    .replace(/[^A-Za-z0-9_]/g, "_");
}
