import test from "node:test";
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("claude plugin marketplace metadata is present and points at the versioned github launcher", () => {
  const marketplace = JSON.parse(fs.readFileSync(".claude-plugin/marketplace.json", "utf8"));
  const plugin = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  const mcp = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));

  assert.equal(marketplace.name, "contextforge");
  assert.equal(marketplace.plugins[0].name, "contextforge");
  assert.equal(marketplace.plugins[0].source, "./");
  assert.equal(marketplace.plugins[0].license, "MIT");

  assert.equal(plugin.name, "contextforge");
  assert.equal(plugin.mcpServers, "./.mcp.json");
  assert.equal(plugin.license, "MIT");

  assert.equal(mcp.mcpServers.contextforge.command, "node");
  assert.equal(mcp.mcpServers.contextforge.args[0], "-e");
  assert.doesNotMatch(mcp.mcpServers.contextforge.args[1], /CLAUDE_PLUGIN_ROOT\|\|process\.cwd\(\)/);
  assert.match(mcp.mcpServers.contextforge.args[1], /CONTEXTFORGE_INLINE_LAUNCHER_MODE==='inspect'/);
  assert.match(mcp.mcpServers.contextforge.args[1], /cachedScript/);
  assert.match(
    mcp.mcpServers.contextforge.args[1],
    /installSpec=`github:Yabuku-xD\/contextforge#v\$\{version\}`/
  );
  assert.equal(mcp.mcpServers.contextforge.args[2], "--");
});

test("inline marketplace launcher resolves the cached bootstrap outside the target repo cwd", () => {
  const plugin = JSON.parse(fs.readFileSync(".claude-plugin/plugin.json", "utf8"));
  const mcp = JSON.parse(fs.readFileSync(".mcp.json", "utf8"));
  const launcher = mcp.mcpServers.contextforge.args[1];
  const repoCwd = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-launcher-cwd-"));
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-launcher-runtime-"));

  const result = cp.spawnSync(process.execPath, ["-e", launcher, "--"], {
    cwd: repoCwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CONTEXTFORGE_INLINE_LAUNCHER_MODE: "inspect",
      CONTEXTFORGE_RUNTIME_ROOT: runtimeRoot
    }
  });

  assert.equal(result.status, 0, result.stderr);

  const payload = JSON.parse(result.stdout);
  const expectedCachedScript = path.join(
    runtimeRoot,
    `v${plugin.version}`,
    "node_modules",
    "contextforge",
    "dist",
    ".claude-plugin",
    "bootstrap-mcp.js"
  );

  assert.equal(payload.version, plugin.version);
  assert.equal(payload.pluginRoot, null);
  assert.equal(payload.localScript, null);
  assert.equal(payload.cachedScript, expectedCachedScript);
  assert.equal(payload.cachedExists, false);
  assert.equal(payload.installSpec, `github:Yabuku-xD/contextforge#v${plugin.version}`);
});
