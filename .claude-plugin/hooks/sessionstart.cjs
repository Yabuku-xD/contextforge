#!/usr/bin/env node
"use strict";
// Hook launcher stub. Committed alongside the plugin so the SessionStart hook
// works on a fresh GitHub install where dist/ has not been built yet.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const HOOK_RELATIVE = path.join("dist", "hooks", "sessionstart.js");

function safeExit(code) {
  process.exit(typeof code === "number" ? code : 0);
}

function resolvePluginRoot() {
  if (process.env.CLAUDE_PLUGIN_ROOT) {
    return path.resolve(process.env.CLAUDE_PLUGIN_ROOT);
  }
  return path.resolve(__dirname, "..", "..");
}

function readVersion(pluginRoot) {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8")
    );
    return meta.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function resolveHookScript() {
  const pluginRoot = resolvePluginRoot();
  const localScript = path.join(pluginRoot, HOOK_RELATIVE);
  if (fs.existsSync(localScript)) {
    return localScript;
  }

  const version = readVersion(pluginRoot);
  const runtimeRoot = process.env.CONTEXTFORGE_RUNTIME_ROOT
    ? path.resolve(process.env.CONTEXTFORGE_RUNTIME_ROOT)
    : path.join(os.homedir(), ".contextforge", "runtime");
  const cachedScript = path.join(
    runtimeRoot,
    "v" + version,
    "node_modules",
    "contextforge",
    HOOK_RELATIVE
  );
  if (fs.existsSync(cachedScript)) {
    return cachedScript;
  }

  return null;
}

const script = resolveHookScript();
if (!script) {
  // Hook is not available yet. Emit an empty SessionStart payload so Claude
  // Code does not log a hook error and the session can proceed.
  process.stdout.write(
    JSON.stringify({
      continue: true,
      suppressOutput: false,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ""
      }
    }) + "\n"
  );
  safeExit(0);
}

const child = cp.spawn(process.execPath, [script], {
  stdio: "inherit",
  env: process.env
});

child.on("error", () => {
  process.stdout.write(
    JSON.stringify({
      continue: true,
      suppressOutput: false,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ""
      }
    }) + "\n"
  );
  safeExit(0);
});
child.on("exit", (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
      return;
    } catch {
      safeExit(0);
    }
  }
  safeExit(code);
});
