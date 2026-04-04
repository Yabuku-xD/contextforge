import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { installClaudeCodeProject, mergeClaudeCodePermissions } from "../../src/install/claude-code.js";

function writableTempBase() {
  const candidates = [os.tmpdir(), path.resolve(".tmp-tests")];
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No writable temp directory available for install tests.");
}

test("installClaudeCodeProject creates or merges a Claude Code mcp config", () => {
  const tempDir = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-install-"));
  const configPath = path.join(tempDir, ".mcp.json");
  const settingsPath = path.join(tempDir, ".claude", "settings.local.json");

  fs.writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      existing: {
        command: "example-server"
      }
    }
  }, null, 2));
  fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    permissions: {
      allow: [
        "mcp__plugin_contextforge_contextforge__forge_start",
        "mcp__plugin_contextforge_contextforge__forge_bash"
      ]
    }
  }, null, 2));

  const result = installClaudeCodeProject(tempDir);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.status, "created");
  assert.equal(result.serverName, "contextforge");
  assert.equal(config.mcpServers.existing.command, "example-server");
  assert.equal(config.mcpServers.contextforge.command, "node");
  assert.equal(config.mcpServers.contextforge.args[1], "--root");
  assert.equal(config.mcpServers.contextforge.args[2], ".");
  assert.equal(config.mcpServers.contextforge.env.CONTEXTFORGE_USE_ACTIVE_SESSION, "1");
  assert.equal(result.permissionsPath, settingsPath);
  assert.ok(result.allowedTools >= 30);
  assert.equal(settings.permissions.defaultMode, undefined);
  assert.ok(settings.permissions.allow.includes("mcp__contextforge__forge_start"));
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_start"));
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_walk"));
  assert.ok(!settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_bash"));
  assert.ok(!settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_write"));
  assert.ok(!settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_edit"));
});

test("installClaudeCodeProject can opt into mutation approvals and dontAsk mode", () => {
  const tempDir = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-install-unsafe-"));
  const result = installClaudeCodeProject(tempDir, {
    allowMutations: true,
    dontAsk: true
  });
  const settingsPath = path.join(tempDir, ".claude", "settings.local.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.mutatingToolsAllowed, true);
  assert.equal(result.defaultMode, "dontAsk");
  assert.equal(settings.permissions.defaultMode, "dontAsk");
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_bash"));
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_write"));
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_edit"));
});

test("mergeClaudeCodePermissions preserves existing project-local Claude settings", () => {
  const tempDir = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-install-preserve-"));
  const settingsPath = path.join(tempDir, ".claude", "settings.local.json");
  fs.mkdirSync(path.join(tempDir, ".claude"), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    enabledMcpjsonServers: ["contextforge"],
    enableAllProjectMcpServers: true
  }, null, 2));

  const result = mergeClaudeCodePermissions(tempDir, {
    allowMutations: false,
    dontAsk: false
  });
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.defaultMode, null);
  assert.deepEqual(settings.enabledMcpjsonServers, ["contextforge"]);
  assert.equal(settings.enableAllProjectMcpServers, true);
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_start"));
  assert.ok(settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_walk"));
  assert.ok(!settings.permissions.allow.includes("mcp__plugin_contextforge_contextforge__forge_bash"));
});
