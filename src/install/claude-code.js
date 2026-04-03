import path from "node:path";
import { fileURLToPath } from "node:url";

import { exists, readText, writeText } from "../utils/fs.js";

const DEFAULT_SERVER_NAME = "contextforge";
const MCP_SERVER_PATH = fileURLToPath(new URL("../mcp-server.js", import.meta.url));

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

  return {
    targetDir: resolvedTarget,
    configPath,
    serverName,
    serverPath: MCP_SERVER_PATH,
    status: previousEntry ? (sameEntry(previousEntry, nextEntry) ? "unchanged" : "updated") : "created"
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
