import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installClaudeCodeProject } from "../../src/install/claude-code.js";

test("installClaudeCodeProject creates or merges a Claude Code mcp config", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-install-"));
  const configPath = path.join(tempDir, ".mcp.json");

  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      existing: {
        command: "example-server"
      }
    }
  }, null, 2));

  const result = installClaudeCodeProject(tempDir);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

  assert.equal(result.status, "created");
  assert.equal(result.serverName, "contextforge");
  assert.equal(config.mcpServers.existing.command, "example-server");
  assert.equal(config.mcpServers.contextforge.command, "node");
  assert.equal(config.mcpServers.contextforge.args[1], "--root");
  assert.equal(config.mcpServers.contextforge.args[2], ".");
  assert.equal(config.mcpServers.contextforge.env.CONTEXTFORGE_USE_ACTIVE_SESSION, "1");
});
