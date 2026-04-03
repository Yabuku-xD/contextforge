import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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

  assert.equal(mcp.mcpServers.contextforge.command, "npx");
  assert.equal(mcp.mcpServers.contextforge.args[0], "-y");
  assert.equal(mcp.mcpServers.contextforge.args[1], "github:Yabuku-xD/contextforge#v0.1.5");
  assert.equal(mcp.mcpServers.contextforge.args[2], "mcp-stdio");
});
