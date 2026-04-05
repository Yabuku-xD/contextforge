#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncClaudeCodePermissions } from "../src/install/claude-code.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(scriptDir, "..");
const packageMeta = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
const packageName = packageMeta.name ?? "contextforge";
const packageVersion = packageMeta.version ?? "0.0.0";
const runtimeRoot = process.env.CONTEXTFORGE_RUNTIME_ROOT
  ? path.resolve(process.env.CONTEXTFORGE_RUNTIME_ROOT)
  : path.join(os.homedir(), ".contextforge", "runtime");

const launchPlan = resolveLaunchPlan();

if (process.env.CONTEXTFORGE_BOOTSTRAP_MODE === "inspect") {
  process.stdout.write(`${JSON.stringify(launchPlan, null, 2)}\n`);
  process.exit(0);
}

if (launchPlan.installNeeded) {
  ensureRuntimeInstall(launchPlan);
}

syncProjectPermissions();
launchServer(launchPlan.serverPath, process.argv.slice(2));

function resolveLaunchPlan() {
  const localServerPath = path.join(pluginRoot, "src", "mcp-server.js");
  const localDepsAvailable = hasRuntimeDependencies(pluginRoot);
  if (localDepsAvailable && fs.existsSync(localServerPath)) {
    return {
      source: "local",
      packageName,
      version: packageVersion,
      repoRoot: pluginRoot,
      dependencyRoot: pluginRoot,
      serverPath: localServerPath,
      cacheRoot: null,
      installNeeded: false,
      installSpec: null
    };
  }

  const cacheRoot = path.join(runtimeRoot, `v${packageVersion}`);
  const cachedPackageRoot = path.join(cacheRoot, "node_modules", packageName);
  const cachedServerPath = path.join(cachedPackageRoot, "src", "mcp-server.js");

  return {
    source: "cache",
    packageName,
    version: packageVersion,
    repoRoot: pluginRoot,
    cacheRoot,
    dependencyRoot: cacheRoot,
    serverPath: cachedServerPath,
    installNeeded: !hasRuntimeDependencies(cachedPackageRoot, cacheRoot),
    installSpec: buildInstallSpec(packageMeta)
  };
}

function hasRuntimeDependencies(packageRoot, dependencyRoot = packageRoot) {
  if (!packageRoot || !dependencyRoot || !fs.existsSync(packageRoot) || !fs.existsSync(dependencyRoot)) {
    return false;
  }

  const requiredPaths = [
    path.join(packageRoot, "src", "mcp-server.js"),
    path.join(dependencyRoot, "node_modules", "@modelcontextprotocol", "sdk"),
    path.join(dependencyRoot, "node_modules", "tree-sitter"),
    path.join(dependencyRoot, "node_modules", "zod")
  ];

  return requiredPaths.every((entry) => fs.existsSync(entry));
}

function buildInstallSpec(meta) {
  const repositoryUrl = typeof meta.repository === "string"
    ? meta.repository
    : meta.repository?.url ?? meta.homepage ?? "";
  const normalized = repositoryUrl
    .replace(/^git\+/, "")
    .replace(/\.git$/, "")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");
  const match = normalized.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/);

  if (!match) {
    throw new Error(`Unable to derive GitHub install spec from repository URL: ${repositoryUrl}`);
  }

  return `github:${match[1]}#v${packageVersion}`;
}

function ensureRuntimeInstall(plan) {
  fs.mkdirSync(plan.cacheRoot, { recursive: true });

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const installArgs = [
    "install",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--prefer-offline",
    "--prefix",
    plan.cacheRoot,
    plan.installSpec
  ];
  const result = spawnSync(npmCommand, installArgs, {
    cwd: pluginRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_loglevel: process.env.npm_config_loglevel ?? "error"
    }
  });

  const installOutput = [result.stdout, result.stderr].filter(Boolean).join("");
  if (installOutput && (result.status !== 0 || process.env.CONTEXTFORGE_BOOTSTRAP_DEBUG === "1")) {
    process.stderr.write(installOutput);
  }

  if (result.status !== 0) {
    throw new Error(`ContextForge runtime install failed with exit code ${result.status ?? "unknown"}`);
  }

  if (!hasRuntimeDependencies(path.join(plan.cacheRoot, "node_modules", packageName), plan.cacheRoot)) {
    throw new Error("ContextForge runtime install completed, but the cached package is incomplete");
  }
}

function launchServer(serverPath, forwardedArgs) {
  const child = spawn(process.execPath, [serverPath, ...forwardedArgs], {
    stdio: "inherit",
    env: {
      ...process.env,
      CONTEXTFORGE_VERSION: packageVersion
    }
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function syncProjectPermissions() {
  const targetDir = process.cwd();

  if (!shouldSyncProjectPermissions(targetDir)) {
    return;
  }

  try {
    syncClaudeCodePermissions(targetDir, {
      allowMutations: false,
      dontAsk: false
    });
  } catch (error) {
    if (process.env.CONTEXTFORGE_BOOTSTRAP_DEBUG === "1") {
      process.stderr.write(`ContextForge permission sync skipped: ${error.message}\n`);
    }
  }
}

function shouldSyncProjectPermissions(targetDir) {
  if (!targetDir || !fs.existsSync(targetDir)) {
    return false;
  }
  return path.resolve(targetDir) !== path.resolve(os.homedir());
}
