import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

test("claude plugin hooks register a SessionStart guidance hook", () => {
  const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
  const sessionStart = hooks.hooks?.SessionStart?.[0]?.hooks?.[0];

  assert.equal(sessionStart?.type, "command");
  assert.match(sessionStart?.command ?? "", /sessionstart\.mjs$/);
});

test("claude plugin hooks register PreToolUse routing guards", () => {
  const hooks = JSON.parse(fs.readFileSync("hooks/hooks.json", "utf8"));
  const preToolUse = hooks.hooks?.PreToolUse ?? [];
  const matchers = preToolUse.map((entry) => entry.matcher);

  assert.ok(matchers.includes("Bash"));
  assert.ok(matchers.includes("Read"));
  assert.ok(matchers.includes("Grep"));
  assert.ok(matchers.includes("Agent"));
  assert.ok(matchers.includes("Task"));
  for (const entry of preToolUse) {
    assert.equal(entry.hooks?.[0]?.type, "command");
    assert.match(entry.hooks?.[0]?.command ?? "", /pretooluse\.mjs$/);
  }
});

test("sessionstart hook emits ContextForge routing guidance", () => {
  const output = execFileSync(process.execPath, ["hooks/sessionstart.mjs"], { encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_start/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_batch/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_lookup/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_scan/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_understand/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_walk/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_read/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_write/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_edit/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_bash/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_scope/);
  assert.match(payload.hookSpecificOutput.additionalContext, /queue the eager full-repository prime in the background/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /did you read every file/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /did you read the whole project/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /every corner of the files/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /keep the first whole-repo answer compact/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /ContextForge/);
});

test("pretooluse denies broad repo subagent fanout", () => {
  const output = execFileSync(
    process.execPath,
    ["hooks/pretooluse.mjs"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: {
          prompt: "Go through every single file, folder, and subfolder in this project and understand the whole monorepo."
        }
      })
    }
  );

  const payload = JSON.parse(output);
  assert.equal(payload.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(payload.hookSpecificOutput.permissionDecision, "deny");
  assert.match(payload.hookSpecificOutput.permissionDecisionReason, /ContextForge/i);
});

test("pretooluse nudges broad repo discovery back toward ContextForge", () => {
  const output = execFileSync(
    process.execPath,
    ["hooks/pretooluse.mjs"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command: "find . -maxdepth 4 -type f | head -200"
        }
      })
    }
  );

  const payload = JSON.parse(output);
  assert.equal(payload.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(payload.hookSpecificOutput.additionalContext, /ContextForge/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /permission-denied/i);
});

test("pretooluse routes output-heavy bash toward forge_batch", () => {
  const output = execFileSync(
    process.execPath,
    ["hooks/pretooluse.mjs"],
    {
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Bash",
        tool_input: {
          command: "git diff --stat HEAD~3..HEAD"
        }
      })
    }
  );

  const payload = JSON.parse(output);
  assert.equal(payload.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_batch/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /permission-denied/i);
});
