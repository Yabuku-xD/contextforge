import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const skillNames = [
  "contextforge",
  "forge-understand",
  "forge-walk",
  "forge-read",
  "forge-write",
  "forge-bash",
  "forge-search",
  "forge-impact",
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
