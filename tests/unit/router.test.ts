import test from "node:test";
import assert from "node:assert/strict";

import { classifyTask } from "../../src/router/classify-task.js";
import { classifyContent } from "../../src/router/classify-content.js";
import { decideRoute } from "../../src/router/bypass-policy.js";
import { extractQuerySignals, recommendForgeTool } from "../../src/router/query-signals.js";

test("classifyTask distinguishes trivial and complex prompts", () => {
  assert.equal(classifyTask("hi").label, "trivial");
  assert.equal(classifyTask("refactor the auth module and explain the root cause").label, "complex");
  assert.equal(classifyTask("why is checkout timing out and which files are likely involved?").label, "complex");
  assert.equal(classifyTask("go through every single file folder and subfolder in this whole project and explain the architecture").label, "complex");
  assert.equal(classifyTask("Understand the entire pi-mono monorepo structure - every file, folder, and subfolder").label, "complex");
});

test("classifyContent detects code logs and dom snapshots", () => {
  assert.equal(classifyContent("export function demo() {\n  return 1;\n}", { filePath: "demo.js" }), "code");
  assert.equal(classifyContent("2026-01-01 INFO server started\n2026-01-01 ERROR timeout", { filePath: "server.log" }), "log");
  assert.equal(classifyContent("<button data-testid=\"checkout-submit\">Submit</button>", { filePath: "snapshot.html" }), "dom_snapshot");
});

test("bypass policy keeps code exact and logs compressible", () => {
  assert.equal(decideRoute("code"), "exact");
  assert.equal(decideRoute("log"), "lossy_safe_with_invariant_check");
});

test("recommendForgeTool routes broad natural-language prompts to the intended ContextForge tools", () => {
  const cases = [
    ["why is test.sh here and what role does it play?", "forge_why"],
    ["what touched this branch and which areas changed?", "forge_changes"],
    ["what breaks if I change src/mcp-server.ts?", "forge_impact"],
    ["where is createContextForge defined?", "forge_symbol"],
    ["how do these modules fit together?", "forge_scope"],
    ["show me src/contextforge.ts", "forge_read"],
    ["replace this exact block in src/contextforge.ts", "forge_edit"],
    ["create docs/notes.md with this content", "forge_write"],
    ["run git status here", "forge_bash"],
    ["run tests and summarize the failures", "forge_batch"],
    ["search the saved logs from earlier", "forge_lookup"],
    ["continue where we left off", "forge_resume"],
    ["what should you remember before we continue?", "forge_memory_wakeup"],
    ["remember this decision long-term", "forge_memory_save"],
    ["what do you remember about auth retries?", "forge_memory_search"],
    ["show the memory map for this project", "forge_memory_navigate"],
    ["timeline of ContextForge versions", "forge_memory_timeline"],
    ["make me a repo map", "forge_map"],
    ["generate the repo wiki", "forge_wiki"],
    ["show integration contracts", "forge_contracts"],
    ["what repos are registered?", "forge_list_repos"],
    ["search across grouped repos", "forge_group_query"],
    ["status across grouped repos", "forge_group_status"],
    ["go through every file folder and subfolder in this repository", "forge_walk"],
    ["understand this codebase and explain the architecture", "forge_understand"]
  ] as const;

  for (const [query, expectedTool] of cases) {
    const recommendation = recommendForgeTool(extractQuerySignals(query));
    assert.equal(recommendation.tool, expectedTool, query);
  }
});

test("extractQuerySignals captures scoped file and memory intents without escalating incorrectly", () => {
  const scopedRead = extractQuerySignals("show me src/router/query-signals.ts");
  assert.equal(scopedRead.intentRead, true);
  assert.equal(scopedRead.scopeHints.length > 0, true);
  assert.equal(scopedRead.exhaustive, false);

  const memoryPrompt = extractQuerySignals("what should you remember before we continue?");
  assert.equal(memoryPrompt.intentMemoryWakeup, true);
  assert.equal(memoryPrompt.broadRepo, false);

  const negatedPrompt = extractQuerySignals("don't walk the whole repo, just show me package.json");
  assert.equal(negatedPrompt.negation, true);
  assert.equal(negatedPrompt.intentRead, true);
});
