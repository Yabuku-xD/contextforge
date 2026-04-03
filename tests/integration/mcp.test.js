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
    args: [path.resolve("src/mcp-server.js"), "--root", sampleRepo],
    cwd: path.resolve("."),
    stderr: "pipe"
  });

  await client.connect(transport);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "forge_start"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_search"));

    const startup = await client.callTool({
      name: "forge_start",
      arguments: {
        query: "why is checkout timing out and which files are likely involved?"
      }
    });
    assert.ok(!startup.isError);

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
  } finally {
    await client.close();
    await transport.close();
  }
});
