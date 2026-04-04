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

test("sessionstart hook emits ContextForge routing guidance", () => {
  const output = execFileSync(process.execPath, ["hooks/sessionstart.mjs"], { encoding: "utf8" });
  const payload = JSON.parse(output);

  assert.equal(payload.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_start/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_scan/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_understand/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_walk/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_read/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_write/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_edit/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_bash/);
  assert.match(payload.hookSpecificOutput.additionalContext, /forge_scope/);
  assert.match(payload.hookSpecificOutput.additionalContext, /eagerly read\/index the whole repository/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /did you read every file/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /did you read the whole project/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /every corner of the files/i);
  assert.match(payload.hookSpecificOutput.additionalContext, /ContextForge/);
});
