#!/usr/bin/env node
import path from "node:path";
import { createContextForge } from "./contextforge.js";
import { TOOL_REGISTRY } from "./tools/registry.js";
import { runBenchmarks } from "./benchmark.js";
import { runOpenTrack, runReleaseGates } from "./open-track.js";
import { runClosedTrack, runPhase3, runSweBenchSubset } from "./phase3.js";
import { reportInventory, validateReportFile } from "./reports.js";
import { runReleaseStatus } from "./release.js";
import { runScoreboard } from "./scoreboard.js";
import { installClaudeCodeProject } from "./install/claude-code.js";
import { clearActiveSession, readActiveSession, rememberActiveSession, resolveRuntimeSessionId } from "./session/runtime.js";
import { startMcpServer } from "./mcp-server.js";

async function main(argv) {
  const [command = "doctor", ...rawRest] = argv.slice(2);
  const { positionals: rest, flags } = parseCliArgs(rawRest);

  if (command === "benchmark") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runBenchmarks(rootDir), null, 2));
    return;
  }

  if (command === "compare") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runOpenTrack(rootDir), null, 2));
    return;
  }

  if (command === "gate") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runReleaseGates(rootDir), null, 2));
    return;
  }

  if (command === "swebench") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runSweBenchSubset(rootDir), null, 2));
    return;
  }

  if (command === "blackbox") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runClosedTrack(rootDir), null, 2));
    return;
  }

  if (command === "phase3") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runPhase3(rootDir), null, 2));
    return;
  }

  if (command === "release") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runReleaseStatus(rootDir), null, 2));
    return;
  }

  if (command === "install-claude") {
    const targetDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(installClaudeCodeProject(targetDir, {
      allowMutations: flags.allowMutations,
      dontAsk: flags.dontAsk
    }), null, 2));
    return;
  }

  if (command === "mcp-stdio") {
    await startMcpServer(rest);
    return;
  }

  if (command === "scoreboard") {
    const rootDir = path.resolve(rest[0] ?? process.cwd());
    console.log(JSON.stringify(await runScoreboard(rootDir), null, 2));
    return;
  }

  if (command === "report-status") {
    console.log(JSON.stringify(reportInventory(), null, 2));
    return;
  }

  if (command === "validate-report") {
    const filePath = rest[0];
    if (!filePath) {
      throw new Error("validate-report requires a path to a *.report.json file");
    }

    console.log(JSON.stringify(validateReportFile(filePath), null, 2));
    return;
  }

  const rootOnlyCommands = new Set(["doctor", "index", "resume", "stats", "purge", "active-session", "clear-active-session"]);
  const query = rootOnlyCommands.has(command) ? "" : rest[0] ?? "";
  const rootDir = path.resolve(rootOnlyCommands.has(command) ? (rest[0] ?? process.cwd()) : (rest[1] ?? process.cwd()));
  if (command === "active-session") {
    console.log(JSON.stringify(readActiveSession(rootDir), null, 2));
    return;
  }

  if (command === "clear-active-session") {
    console.log(JSON.stringify(clearActiveSession(rootDir, flags.sessionId ?? null), null, 2));
    return;
  }

  const resolvedSessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: flags.sessionId,
    preferActive: flags.useActiveSession
  });
  const forge = createContextForge(rootDir, resolvedSessionId ? { sessionId: resolvedSessionId } : {});
  if (flags.rememberSession || command === "startup") {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "cli",
      command
    });
  }

  try {
    switch (command) {
      case "index":
        console.log(JSON.stringify(forge.indexRepository(), null, 2));
        break;
      case "search":
        console.log(JSON.stringify(forge.search(query), null, 2));
        break;
      case "symbol":
        console.log(JSON.stringify(forge.symbol(query), null, 2));
        break;
      case "scope":
        console.log(JSON.stringify(forge.scope(query, rest[2] ?? "auto"), null, 2));
        break;
      case "impact":
        console.log(JSON.stringify(forge.impact(query), null, 2));
        break;
      case "why":
        console.log(JSON.stringify(forge.why(query), null, 2));
        break;
      case "resume":
        console.log(JSON.stringify(forge.resume(), null, 2));
        break;
      case "startup":
        console.log(JSON.stringify(forge.startup(query), null, 2));
        break;
      case "understand":
        console.log(JSON.stringify(forge.understand(query), null, 2));
        break;
      case "walk":
        console.log(JSON.stringify(forge.walk(query), null, 2));
        break;
      case "read":
        console.log(JSON.stringify(forge.read(query, {
          startLine: rest[2],
          endLine: rest[3],
          maxLines: rest[4],
          limit: rest[2]
        }), null, 2));
        break;
      case "write":
        console.log(JSON.stringify(forge.write(query, rest[2] ?? "", {
          createDirs: rest[3]
        }), null, 2));
        break;
      case "edit":
        console.log(JSON.stringify(forge.edit(query, rest[2] ?? "", rest[3] ?? "", {
          replaceAll: rest[4]
        }), null, 2));
        break;
      case "bash":
        console.log(JSON.stringify(await forge.bash(query, {
          cwd: rest[2],
          timeoutMs: rest[3],
          maxChars: rest[4]
        }), null, 2));
        break;
      case "compress": {
        const artifact = query;
        const metadataArg = rest[2];
        const metadata = metadataArg ? JSON.parse(metadataArg) : {};
        console.log(JSON.stringify(await forge.processArtifact(artifact, metadata), null, 2));
        break;
      }
      case "fault": {
        forge.startup("why is checkout timing out and which files are likely involved?");
        const state = forge.pageState();
        const page = state.pages.find((entry) => entry.sourceItemId === query) ?? state.pages[0];
        console.log(JSON.stringify(page ? forge.notePageFault(page.pageId, rest[2] ?? "repeat_fault") : null, null, 2));
        break;
      }
      case "prefetch":
        console.log(JSON.stringify(forge.prefetchSuggestions(), null, 2));
        break;
      case "stats":
        console.log(JSON.stringify(forge.stats(), null, 2));
        break;
      case "purge":
        console.log(JSON.stringify(forge.purge(), null, 2));
        break;
      case "tool":
        console.log(JSON.stringify(TOOL_REGISTRY.forge_get_tool.execute(forge, { tool_name: query || "list" }), null, 2));
        break;
      case "doctor":
      default:
        console.log(JSON.stringify(forge.doctor(), null, 2));
        break;
    }
  } finally {
    forge.close();
  }
}

function parseCliArgs(args) {
  const positionals = [];
  const flags = {
    sessionId: null,
    useActiveSession: false,
    rememberSession: false,
    allowMutations: false,
    dontAsk: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--session-id") {
      flags.sessionId = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (value.startsWith("--session-id=")) {
      flags.sessionId = value.slice("--session-id=".length);
      continue;
    }

    if (value === "--use-active-session") {
      flags.useActiveSession = true;
      continue;
    }

    if (value === "--remember-session") {
      flags.rememberSession = true;
      continue;
    }

    if (value === "--allow-mutations") {
      flags.allowMutations = true;
      continue;
    }

    if (value === "--dont-ask") {
      flags.dontAsk = true;
      continue;
    }

    positionals.push(value);
  }

  return { positionals, flags };
}

main(process.argv).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
