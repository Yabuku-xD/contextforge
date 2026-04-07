import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");
const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contextforge-mcp-memory-"));

function textContent(resource: { contents: Array<{ text?: string; blob?: string }> }) {
  const [first] = resource.contents ?? [];
  return "text" in (first ?? {}) ? String(first?.text ?? "") : "";
}

test("mcp server exposes ContextForge tools over stdio", async () => {
  const client = new Client({ name: "contextforge-test-client", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/.claude-plugin/bootstrap-mcp.js"), "--root", sampleRepo],
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CONTEXTFORGE_MEMORY_ROOT: memoryRoot
    },
    stderr: "pipe"
  });

  await client.connect(transport);

  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "forge_start"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_memory_status"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_memory_wakeup"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_memory_search"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_memory_navigate"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_batch"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_lookup"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_scan"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_understand"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_walk"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_read"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_write"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_edit"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_bash"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_search"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_changes"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_rename"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_map"));
    assert.ok(tools.tools.some((tool) => tool.name === "forge_contracts"));

    const toolDescriptions = Object.fromEntries(tools.tools.map((tool) => [tool.name, tool.description ?? ""]));
    assert.match(toolDescriptions.forge_why, /why does this file matter|what is this for/i);
    assert.match(toolDescriptions.forge_impact, /what breaks if I change X|what else is affected/i);
    assert.match(toolDescriptions.forge_changes, /what changed on this branch|summarize the current changes/i);
    assert.match(toolDescriptions.forge_batch, /run tests and summarize|show git diff without flooding chat/i);
    assert.match(toolDescriptions.forge_lookup, /search the logs from earlier|saved test output/i);
    assert.match(toolDescriptions.forge_symbol, /where is function X defined|find symbol named/i);
    assert.match(toolDescriptions.forge_scope, /how is this project structured|which modules talk to each other/i);
    assert.match(toolDescriptions.forge_memory_wakeup, /wake-up memory|prior decisions|project history/i);
    assert.match(toolDescriptions.forge_memory_save, /remember this|save this decision|long-term/i);
    assert.match(toolDescriptions.forge_read, /show me this file|peek at package\.json/i);
    assert.match(toolDescriptions.forge_edit, /patch this block in place|swap this snippet/i);
    assert.match(toolDescriptions.forge_write, /create this file|make docs\/notes\.md/i);
    assert.match(toolDescriptions.forge_bash, /run git status here|run pwd/i);

    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://repo/overview"));
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://repo/flows"));
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://repo/schema"));
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://memory/status"));
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://memory/wakeup"));
    assert.ok(resources.resources.some((resource) => resource.uri === "contextforge://memory/navigate"));

    const overviewResource = await client.readResource({
      uri: "contextforge://repo/overview"
    });
    assert.match(textContent(overviewResource), /importantFiles|topLevel/i);

    const memoryStatusResource = await client.readResource({
      uri: "contextforge://memory/status"
    });
    assert.match(textContent(memoryStatusResource), /globalMemory|L0_identity/i);

    const memoryNavigateResource = await client.readResource({
      uri: "contextforge://memory/navigate"
    });
    assert.match(textContent(memoryNavigateResource), /topology|wings|summary/i);

    const generatedMapPath = path.join(sampleRepo, ".contextforge", "generated", "map.md");
    const generatedContractsPath = path.join(sampleRepo, ".contextforge", "generated", "contracts.md");
    if (fs.existsSync(generatedMapPath)) fs.rmSync(generatedMapPath, { force: true });
    if (fs.existsSync(generatedContractsPath)) fs.rmSync(generatedContractsPath, { force: true });

    const mapResource = await client.readResource({
      uri: "contextforge://repo/map"
    });
    assert.match(textContent(mapResource), /"persisted":\s*false/);
    assert.equal(fs.existsSync(generatedMapPath), false);

    const contractsResource = await client.readResource({
      uri: "contextforge://repo/contracts"
    });
    assert.match(textContent(contractsResource), /"persisted":\s*false/);
    assert.equal(fs.existsSync(generatedContractsPath), false);

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
    assert.match(startup.content[0].text, /recommendedNextTool/);
    assert.match(startup.content[0].text, /recommendedReason/);

    const memorySave = await client.callTool({
      name: "forge_memory_save",
      arguments: {
        title: "Test memory",
        summary: "Remember that ContextForge now has a durable memory layer."
      }
    });
    assert.ok(!memorySave.isError);
    assert.match(memorySave.content[0].text, /saved|entry/);

    const memoryWakeup = await client.callTool({
      name: "forge_memory_wakeup",
      arguments: {}
    });
    assert.ok(!memoryWakeup.isError);
    assert.match(memoryWakeup.content[0].text, /L0|L1/);

    const memorySearch = await client.callTool({
      name: "forge_memory_search",
      arguments: {
        query: "durable memory layer"
      }
    });
    assert.ok(!memorySearch.isError);
    assert.match(memorySearch.content[0].text, /Found .* memory hit|results/);

    const memoryNavigate = await client.callTool({
      name: "forge_memory_navigate",
      arguments: {}
    });
    assert.ok(!memoryNavigate.isError);
    assert.match(memoryNavigate.content[0].text, /topology|wings|summary/);

    const search = await client.callTool({
      name: "forge_search",
      arguments: {
        query: "checkout timeout",
        limit: "6"
      }
    });
    assert.ok(!search.isError);
    assert.match(search.content[0].text, /checkout/i);
    assert.ok(search.content[0].text.length < 6000);
    assert.match(search.content[0].text, /contextSavings/);
    const searchPayload: any = search.structuredContent;
    assert.ok(Array.isArray(searchPayload.items));
    assert.ok(searchPayload.items.length <= 6);
    assert.ok(searchPayload.items.every((item: any) => typeof item.preview === "string"));
    assert.ok(searchPayload.contextSavings.savedBytes > 0);
    assert.match(search.content[0].text, /chooseOneTargetThenDrillDown/);

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
    assert.match(walk.content[0].text, /noManualFollowupReads/);
    assert.match(walk.content[0].text, /initialAnswerShouldUseAuditOnly/);
    assert.match(walk.content[0].text, /initialAnswerReady/);
    assert.match(walk.content[0].text, /forbidFollowupTools/);
    assert.match(walk.content[0].text, /forge_batch/);
    assert.match(walk.content[0].text, /contextSavings/);
    assert.match(walk.content[0].text, /savedBytes/);

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

    const batch = await client.callTool({
      name: "forge_batch",
      arguments: {
        commands: ["printf 'alpha-secret\\nbeta\\n'"],
        queries: ["alpha-secret"]
      }
    });
    assert.ok(!batch.isError);
    assert.match(batch.content[0].text, /indexedSections/);
    assert.match(batch.content[0].text, /receipt_first/);
    assert.match(batch.content[0].text, /contextSavings/);

    const batchPayload: any = batch.structuredContent;
    const lookup = await client.callTool({
      name: "forge_lookup",
      arguments: {
        queries: ["alpha-secret"],
        source_id: batchPayload.sourceId
      }
    });
    assert.ok(!lookup.isError);
    assert.match(lookup.content[0].text, /stored research sources|selected source/i);
    assert.match(lookup.content[0].text, /alpha-secret/i);
    assert.match(lookup.content[0].text, /contextSavings/);

    const stats = await client.callTool({
      name: "forge_stats",
      arguments: {}
    });
    assert.ok(!stats.isError);
    assert.match(stats.content[0].text, /deliverySavings/);
    assert.match(stats.content[0].text, /savedTokens/);

    const changes = await client.callTool({
      name: "forge_changes",
      arguments: {
        scope: "unstaged"
      }
    });
    assert.ok(!changes.isError);

    const map = await client.callTool({
      name: "forge_map",
      arguments: {}
    });
    assert.ok(!map.isError);
    assert.match(map.content[0].text, /generated|path|summary/i);
  } finally {
    await client.close();
    await transport.close();
  }
});

test("bootstrap launcher resolves the local dev server when dependencies are available", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [path.resolve("dist/.claude-plugin/bootstrap-mcp.js")], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CONTEXTFORGE_MEMORY_ROOT: memoryRoot,
      CONTEXTFORGE_BOOTSTRAP_MODE: "inspect"
    },
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.source, "local");
  assert.match(payload.serverPath, /dist\/src\/mcp-server\.js$/);
  assert.equal(payload.installNeeded, false);
});
