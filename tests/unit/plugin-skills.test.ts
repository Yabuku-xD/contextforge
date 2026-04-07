import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const skillNames = [
  "contextforge",
  "forge-start",
  "forge-memory-status",
  "forge-memory-wakeup",
  "forge-memory-recall",
  "forge-memory-search",
  "forge-memory-save",
  "forge-memory-profile-set",
  "forge-memory-profile-get",
  "forge-memory-diary-write",
  "forge-memory-diary-read",
  "forge-memory-fact-add",
  "forge-memory-fact-invalidate",
  "forge-memory-fact-query",
  "forge-memory-timeline",
  "forge-scan",
  "forge-understand",
  "forge-walk",
  "forge-batch",
  "forge-lookup",
  "forge-tools",
  "forge-read",
  "forge-write",
  "forge-bash",
  "forge-search",
  "forge-symbol",
  "forge-scope",
  "forge-impact",
  "forge-changes",
  "forge-rename",
  "forge-why",
  "forge-map",
  "forge-contracts",
  "forge-wiki",
  "forge-list-repos",
  "forge-group-query",
  "forge-group-status",
  "forge-session",
  "forge-resume",
  "forge-stats",
  "forge-doctor",
  "forge-edit"
];

test("contextforge plugin ships user-invocable chat command skills", () => {
  for (const skillName of skillNames) {
    const skillPath = path.join("skills", skillName, "SKILL.md");
    assert.equal(fs.existsSync(skillPath), true, `${skillPath} should exist`);
    const body = fs.readFileSync(skillPath, "utf8");

    assert.match(body, /^---\n[\s\S]+?\n---\n/, `${skillName} should have frontmatter`);
    assert.match(body, new RegExp(`name: ${skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(body, /user-invocable:\s*true/);
    assert.match(body, /Trigger:\s*\/contextforge:/);
  }
});

test("forge-edit skill explicitly routes through ContextForge before built-in file tools", () => {
  const body = fs.readFileSync(path.join("skills", "forge-edit", "SKILL.md"), "utf8");

  assert.match(body, /forge_search/);
  assert.match(body, /forge_read/);
  assert.match(body, /forge_write/);
  assert.match(body, /forge_symbol/);
  assert.match(body, /forge_impact/);
  assert.doesNotMatch(body, /built-in file tools/);
});

test("contextforge router skill covers why, changes, rename, and research prompts", () => {
  const body = fs.readFileSync(path.join("skills", "contextforge", "SKILL.md"), "utf8");

  assert.match(body, /forge_batch/);
  assert.match(body, /forge_lookup/);
  assert.match(body, /forge_scope/);
  assert.match(body, /forge_changes/);
  assert.match(body, /forge_rename/);
  assert.match(body, /forge_why/);
  assert.match(body, /forge_map/);
  assert.match(body, /forge_contracts/);
  assert.match(body, /forge_wiki/);
  assert.match(body, /forge_list_repos/);
  assert.match(body, /forge_group_query/);
  assert.match(body, /forge_group_status/);
  assert.match(body, /forge_memory_status/);
  assert.match(body, /forge_memory_wakeup/);
  assert.match(body, /forge_memory_search/);
  assert.match(body, /forge_memory_fact_query/);
  assert.match(body, /forge_memory_timeline/);
});
