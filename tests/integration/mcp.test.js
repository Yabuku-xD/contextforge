import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");

test("mcp server exposes ContextForge tools over stdio", async () => {
  const client = new Client({ name: "contextforge-test-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(".claude-plugin/bootstrap-mcp.mjs"), "--root", sampleRepo],
    cwd: path.resolve("."),
    stderr: "pipe"
  });

  await client.connect(transport);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "forge_start"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_scan"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_understand"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_walk"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_read"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_write"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_edit"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_bash"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_search"));

    const scan = await client.callTool({
      name: "forge_scan",
      arguments: {}
    });
    assert.ok(!scan.isError);
    assert.match(scan.content[0].text, /important files/i);

    const startup = await client.callTool({
      name: "forge_start",
      arguments: {
        query: "why is checkout timing out and which files are likely involved?"
      }
    });
    assert.ok(!startup.isError);
    assert.match(startup.content[0].text, /filesIndexed/);

    const search = await client.callTool({
      name: "forge_search",
      arguments: {
        query: "checkout timeout",
        limit: "3"
      }
    });
    assert.ok(!search.isError);
    assert.match(search.content[0].text, /checkout/i);

    const scope = await client.callTool({
      name: "forge_scope",
      arguments: {
        query: "project structure and architecture overview",
        mode: "collapsed"
      }
    });
    assert.ok(!scope.isError);

    const understand = await client.callTool({
      name: "forge_understand",
      arguments: {
        query: "understand this project structure and important files"
      }
    });
    assert.ok(!understand.isError);
    assert.match(understand.content[0].text, /important files/i);

    const walk = await client.callTool({
      name: "forge_walk",
      arguments: {
        query: "go through every file folder and subfolder in this project"
      }
    });
    assert.ok(!walk.isError);
    assert.match(walk.content[0].text, /exhaustive repository digest|inspected .* repository files locally/i);
    assert.ok(walk.content[0].text.length < 12000);
    assert.match(walk.content[0].text, /receipt_first/);
    assert.match(walk.content[0].text, /firstAnswerWordLimit/);

    const read = await client.callTool({
      name: "forge_read",
      arguments: {
        path: "src/checkout.ts",
        start_line: "1",
        end_line: "3"
      }
    });
    assert.ok(!read.isError);
    assert.match(read.content[0].text, /checkout/i);

    const bash = await client.callTool({
      name: "forge_bash",
      arguments: {
        command: "pwd"
      }
    });
    assert.ok(!bash.isError);
    assert.match(bash.content[0].text, /stdoutPreview/i);
  } finally {
    await client.close();
    await transport.close();
  }
});

test("bootstrap launcher resolves the local dev server when dependencies are available", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [path.resolve(".claude-plugin/bootstrap-mcp.mjs")], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CONTEXTFORGE_BOOTSTRAP_MODE: "inspect"
    },
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.source, "local");
  assert.match(payload.serverPath, /src\/mcp-server\.js$/);
  assert.equal(payload.installNeeded, false);
});
