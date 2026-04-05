import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { createContextForge } from "../../src/contextforge.js";
import { recordSessionEvent } from "../../src/session/events.js";
import { startBridgeServer } from "../../src/server/bridge.js";

const sampleRepo = path.resolve("tests/fixtures/sample-app");
const repoRoot = path.resolve(".");

function writableTempBase() {
  const candidates = [os.tmpdir(), path.join(repoRoot, ".tmp-tests")];
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("No writable temp directory available for tests.");
}

test("Phase 1 can index, search, analyze impact, and resume", async () => {
  const forge = createContextForge(sampleRepo, { sessionId: `test_session_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.filesIndexed >= 3);
    assert.ok(indexSummary.symbolsIndexed >= 5);
    const reusedSummary = forge.indexRepository();
    assert.equal(reusedSummary.reusedIndex, true);

    const searchResults = forge.search("checkout timeout", { limit: 5 });
    assert.ok(searchResults.some((result) => result.label.includes("checkout")));

    const impactResults = forge.impact("shouldRetry");
    assert.ok(impactResults.some((result) => result.canonicalName.includes("createCheckout")));

    const startup = forge.startup("hi");
    assert.equal(startup.task.label, "trivial");
    assert.equal(startup.pages.length, 1);
    assert.ok(startup.index.filesIndexed >= 3);

    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "failure",
      payload: { filePath: "src/checkout.ts", symbolId: "createCheckout", message: "timeout" }
    });

    const resume = forge.resume();
    assert.ok(resume.summary.includes("failure"));

    const why = forge.why("checkout timeout");
    assert.ok(why.seeds.length >= 1);
    assert.ok(why.session.length >= 1);
  } finally {
    forge.close();
  }
});

test("ContextForge can index and understand the repository hosting itself", async () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-self-hosted-"));
  fs.cpSync(repoRoot, tempRoot, {
    recursive: true,
    filter(sourcePath) {
      const relative = path.relative(repoRoot, sourcePath);
      if (!relative) {
        return true;
      }

      return ![
        ".git",
        ".contextforge",
        ".tmp-tests",
        "node_modules",
        "GitNexus-main",
        "context-mode"
      ].some((prefix) => relative === prefix || relative.startsWith(`${prefix}${path.sep}`));
    }
  });

  const forge = createContextForge(tempRoot, { sessionId: `self_hosted_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.filesIndexed > 0);

    const overview = forge.understand("Understand the entire contextforge monorepo structure - every file, folder, and subfolder, and explain what they are doing.");
    assert.ok(overview.topLevel.length > 0);
    assert.ok(overview.importantFiles.length > 0);
    assert.match(overview.summary, /Important files to read first|representative files/i);
    assert.match(overview.mode, /inventory_(first|walk)|exhaustive_walk/);
    assert.match(overview.guidance, /first-pass repository overview|deeper repository map|exhaustive repository digest/i);

    const walk = forge.walk("Go through every single file, folder, and subfolder in this project and explain what each major area does.");
    assert.equal(walk.mode, "exhaustive_walk");
    assert.ok(walk.directorySections.length > 0);
    assert.ok(walk.audit.fileCountInspected > 0);
    assert.equal(walk.audit.readCoverage.openedEveryRepositoryFile, true);
    assert.equal(walk.audit.readCoverage.canAnswerYesToWholeProjectRead, true);
    assert.ok(walk.audit.readCoverage.fullTextLinesRead > 0);
    assert.ok(walk.audit.indexedMemory.complete);
    assert.ok(walk.audit.indexedMemory.fullTextBodiesStored > 0);
    assert.ok(walk.audit.indexedMemory.indexedLineCount > 0);
    assert.equal(walk.audit.indexedMemory.canAnswerYesToRememberingWholeProject, true);
    assert.ok(walk.audit.answerIfAskedWhetherEveryFileWasRead.includes("Yes."));
    assert.ok(walk.audit.answerIfAskedWhetherWholeProjectWasRead.includes("Yes."));
    assert.ok(walk.audit.answerIfAskedWhetherEveryCornerWasRead.includes("Yes."));
    assert.match(walk.guidance, /exhaustive repository digest/i);
    assert.match(walk.summary, /opened all .* repository files locally/i);

    const routed = forge.understand("Go through every single file, folder, and subfolder in this project.");
    assert.equal(routed.mode, "exhaustive_walk");
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ContextForge native file ops handle read write edit directory and bash flows", async () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-fileops-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "fileops-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "app.js"), "export function run() {\n  return 'hello';\n}\n");

  const forge = createContextForge(tempRoot, { sessionId: `file_ops_${Date.now()}` });
  try {
    const startup = forge.startup("prime the repository");
    assert.ok(startup.index.filesIndexed >= 2);
    assert.ok(startup.index.contentCoverage.complete);

    const fileRead = forge.read("src/app.js", { startLine: 1, endLine: 2 });
    assert.equal(fileRead.kind, "file");
    assert.match(fileRead.excerpt, /1 \| export function run/);

    const dirRead = forge.read("src");
    assert.equal(dirRead.kind, "directory");
    assert.ok(dirRead.entries.some((entry) => entry.name === "app.js"));

    const writeResult = forge.write("notes/todo.md", "alpha\nbeta\n");
    assert.equal(writeResult.created, true);
    assert.ok(writeResult.indexSync.filesIndexed >= 3);
    assert.equal(writeResult.indexSync.syncMode, "incremental");
    assert.ok(writeResult.indexSync.contentCoverage.complete);

    const editResult = forge.edit("notes/todo.md", "beta", "gamma");
    assert.equal(editResult.replacements, 1);
    assert.match(editResult.preview, /gamma/);
    assert.ok(editResult.indexSync.filesIndexed >= 3);
    assert.equal(editResult.indexSync.syncMode, "incremental");
    assert.ok(editResult.indexSync.contentCoverage.complete);

    const indexedNotes = forge.db.prepare(`
      SELECT content_kind AS contentKind, content_loaded AS contentLoaded, line_count AS lineCount, byte_count AS byteCount
      FROM files
      WHERE repo_id = ? AND file_path = ?
    `).get(forge.repoId, "notes/todo.md");
    assert.equal(indexedNotes.contentKind, "text");
    assert.equal(indexedNotes.contentLoaded, 1);
    assert.equal(indexedNotes.lineCount, 3);
    assert.ok(indexedNotes.byteCount > 0);

    const bashResult = await forge.bash("pwd");
    assert.equal(bashResult.exitCode, 0);
    assert.match(bashResult.stdoutPreview, /contextforge-fileops-/);

    const batchResult = await forge.batch([
      "printf 'alpha\\nbeta\\n'",
      "printf 'checkout timeout\\n' >&2"
    ], {
      queries: ["beta", "checkout timeout"]
    });
    assert.ok(batchResult.indexedSections >= 2);
    assert.equal(batchResult.queries.length, 2);
    assert.match(batchResult.queries[0].matches[0]?.preview ?? "", /beta/i);

    const lookup = forge.lookup(["checkout timeout"], {
      sourceId: batchResult.sourceId
    });
    assert.equal(lookup.queries.length, 1);
    assert.match(lookup.queries[0].matches[0]?.preview ?? "", /checkout timeout/i);
    assert.ok(forge.stats().research.sources >= 1);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ContextForge exposes graph areas, flows, schema, and generated artifacts", () => {
  const forge = createContextForge(sampleRepo, { sessionId: `graph_surface_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.contentCoverage.complete);

    const areas = forge.areas();
    assert.ok(areas.areaCount >= 1);
    assert.ok(areas.areas[0].summary.length > 0);

    const flows = forge.flows();
    assert.ok(flows.flowCount >= 1);
    assert.ok(flows.flows[0].summary.length > 0);

    const schema = forge.graphSchema();
    assert.ok(schema.nodeTypes.some((entry) => entry.type === "symbol"));
    assert.ok(schema.edgeTypes.some((entry) => entry.type === "call"));

    const map = forge.map();
    assert.ok(fs.existsSync(map.path));
    assert.match(map.markdown, /ContextForge Repository Map/);

    const contracts = forge.contracts();
    assert.ok(Array.isArray(contracts.contracts));
    assert.ok(fs.existsSync(contracts.path));

    const wiki = forge.wiki();
    assert.ok(fs.existsSync(wiki.path));
    assert.match(wiki.markdown, /ContextForge Wiki/);
  } finally {
    forge.close();
  }
});

test("forge_lookup handles code-ish queries and stays scoped to the current session by default", async () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-research-scope-"));
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "research-fixture", version: "1.0.0" }, null, 2));

  const sourceSessionId = `research_source_${Date.now()}`;
  const sourceForge = createContextForge(tempRoot, { sessionId: sourceSessionId });
  let sourceId = null;

  try {
    const batchResult = await sourceForge.batch([
      "printf 'alpha-secret\\nfoo:bar\\nsrc/app.js\\n'",
      "node -e \"process.stdout.write('x'.repeat(12000))\""
    ], {
      label: "research-fixture"
    });
    sourceId = batchResult.sourceId;

    const sameSessionLookup = sourceForge.lookup(["alpha-secret", "foo:bar", "src/app.js"], {
      sourceId
    });
    assert.equal(sameSessionLookup.queries.length, 3);
    assert.match(sameSessionLookup.queries[0].matches[0]?.preview ?? "", /alpha-secret/i);
    assert.match(sameSessionLookup.queries[1].matches[0]?.preview ?? "", /foo:bar/i);
    assert.match(sameSessionLookup.queries[2].matches[0]?.preview ?? "", /src\/app\.js/i);
    assert.ok(batchResult.indexedSections >= 4);
    assert.match(batchResult.commands[1].stdoutPreview, /\[output truncated\]/);
  } finally {
    sourceForge.close();
  }

  const isolatedForge = createContextForge(tempRoot, { sessionId: `research_other_${Date.now()}` });
  try {
    const defaultLookup = isolatedForge.lookup(["alpha-secret"]);
    assert.equal(defaultLookup.queries[0].matches.length, 0);

    const explicitLookup = isolatedForge.lookup(["alpha-secret"], { sourceId });
    assert.equal(explicitLookup.queries[0].matches.length, 0);
  } finally {
    isolatedForge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ContextForge can map git changes and apply coordinated renames", () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-git-aware-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "git-aware-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "service.js"), "export function createUser(name) {\n  return formatUser(name);\n}\n\nexport function formatUser(name) {\n  return name.trim();\n}\n");
  fs.writeFileSync(path.join(tempRoot, "src", "handler.js"), "import { createUser } from './service.js';\n\nexport function handleUser(name) {\n  return createUser(name);\n}\n");

  for (const command of [
    ["git", "init"],
    ["git", "config", "user.email", "contextforge@example.com"],
    ["git", "config", "user.name", "ContextForge Tests"],
    ["git", "add", "."],
    ["git", "commit", "-m", "init"]
  ]) {
    const result = spawnSync(command[0], command.slice(1), {
      cwd: tempRoot,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const forge = createContextForge(tempRoot, { sessionId: `git_changes_${Date.now()}` });
  try {
    const indexSummary = forge.indexRepository();
    assert.ok(indexSummary.contentCoverage.complete);

    fs.writeFileSync(path.join(tempRoot, "src", "handler.js"), "import { createUser } from './service.js';\n\nexport function handleUser(name) {\n  return createUser(name).toUpperCase();\n}\n");

    const changes = forge.changes({ scope: "unstaged" });
    assert.equal(changes.changedFileCount, 1);
    assert.equal(changes.files[0].path, "src/handler.js");
    assert.ok(changes.files[0].matchedSymbols.some((symbol) => symbol.displayName === "handleUser"));

    const preview = forge.rename("createUser", "createAccount", { dryRun: true });
    assert.ok(preview.editCount >= 2);
    assert.ok(preview.edits.some((edit) => edit.confidence === "graph"));

    const applied = forge.rename("createUser", "createAccount", { dryRun: false });
    assert.ok(applied.indexSync);
    assert.match(fs.readFileSync(path.join(tempRoot, "src", "service.js"), "utf8"), /createAccount/);
    assert.match(fs.readFileSync(path.join(tempRoot, "src", "handler.js"), "utf8"), /createAccount/);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("forge_rename avoids touching unrelated same-name symbols in other files", () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-rename-scope-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "rename-scope-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "a.js"), "export function run() { return 1; }\nexport function keep() { return run(); }\n");
  fs.writeFileSync(path.join(tempRoot, "src", "b.js"), "export function run() { return 2; }\nexport function other() { return run(); }\n");

  const forge = createContextForge(tempRoot, { sessionId: `rename_scope_${Date.now()}` });
  try {
    forge.indexRepository();

    const preview = forge.rename("src/a.js::run", "execute", { dryRun: true });
    assert.equal(preview.editCount, 1);
    assert.equal(preview.edits[0].path, "src/a.js");
    assert.ok(preview.skippedFiles.every((entry) => entry.path !== "src/a.js"));
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("ContextForge file ops do not follow symlinks outside the repository", () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-symlink-"));
  const outsideRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-outside-"));
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "symlink-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "top-secret\n");
  fs.symlinkSync(outsideRoot, path.join(tempRoot, "link-out"));

  const forge = createContextForge(tempRoot, { sessionId: `symlink_${Date.now()}` });
  try {
    assert.throws(() => forge.read("link-out/secret.txt"), /resolving symlinks/i);
    assert.throws(() => forge.write("link-out/secret.txt", "after"), /resolving symlinks/i);
    assert.throws(() => forge.edit("link-out/secret.txt", "top", "after"), /resolving symlinks/i);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("forge_start can defer the eager prime on larger repositories", () => {
  const previousThreshold = process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD;
  process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD = "1";
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-deferred-startup-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "deferred-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "app.js"), "export const app = true;\n");
  fs.writeFileSync(path.join(tempRoot, "src", "worker.js"), "export const worker = true;\n");
  const forge = createContextForge(tempRoot, { sessionId: `deferred_startup_${Date.now()}` });

  try {
    const startup = forge.startup("exhaustive full repository walk - every file, folder, subfolder");
    assert.match(startup.index.status, /queued|warming/);
    assert.equal(startup.index.deferred, true);
    assert.ok(startup.index.estimatedFileCount >= 3);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousThreshold == null) {
      delete process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD;
    } else {
      process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD = previousThreshold;
    }
  }
});

test("ContextForge registry, groups, and bridge server work across multiple repos", async () => {
  const previousTempRegistry = process.env.CONTEXTFORGE_REGISTER_TEMP_REPOS;
  process.env.CONTEXTFORGE_REGISTER_TEMP_REPOS = "1";
  const repoA = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-group-a-"));
  const repoB = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-group-b-"));

  fs.mkdirSync(path.join(repoA, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoB, "src"), { recursive: true });
  fs.writeFileSync(path.join(repoA, "package.json"), JSON.stringify({ name: "group-a", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(repoB, "package.json"), JSON.stringify({ name: "group-b", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(repoA, "src", "alpha.js"), "export function alphaCheckout() {\n  return 'checkout';\n}\n");
  fs.writeFileSync(path.join(repoB, "src", "beta.js"), "export function betaCheckout() {\n  return 'checkout beta';\n}\n");

  const forgeA = createContextForge(repoA, { sessionId: `group_a_${Date.now()}` });
  const forgeB = createContextForge(repoB, { sessionId: `group_b_${Date.now()}` });
  const groupName = `integration-group-${Date.now()}`;

  let bridge = null;
  try {
    forgeA.indexRepository();
    forgeB.indexRepository();

    const repos = forgeA.listRepos();
    assert.ok(repos.repos.some((repo) => repo.name === "group-a"));
    assert.ok(repos.repos.some((repo) => repo.name === "group-b"));
    assert.ok(repos.repos.every((repo) => !Object.hasOwn(repo, "rootPath")));

    forgeA.groupCreate(groupName);
    forgeA.groupAdd(groupName, repoA);
    forgeA.groupAdd(groupName, repoB);

    const status = forgeA.groupStatus(groupName);
    assert.equal(status.repos.length, 2);
    assert.ok(status.repos.every((repo) => repo.contentCoverage.complete));

    const groupQuery = forgeA.groupQuery(groupName, "checkout");
    assert.equal(groupQuery.results.length, 2);
    assert.ok(groupQuery.results.some((entry) => entry.matches.length >= 1));

    bridge = await startBridgeServer(repoA, { port: 0 });
    const health = await fetch(`${bridge.url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);

    const overview = await fetch(`${bridge.url}/api/overview`).then((response) => response.json());
    assert.match(overview.summary, /Top-level layout|Important files/i);

    const flows = await fetch(`${bridge.url}/api/flows`).then((response) => response.json());
    assert.ok(flows.flowCount >= 1);
  } finally {
    if (previousTempRegistry == null) {
      delete process.env.CONTEXTFORGE_REGISTER_TEMP_REPOS;
    } else {
      process.env.CONTEXTFORGE_REGISTER_TEMP_REPOS = previousTempRegistry;
    }
    if (bridge) {
      await bridge.close();
    }
    forgeA.close();
    forgeB.close();
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test("forge_start stays usable when the repository database is write-locked", () => {
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-startup-lock-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "startup-lock-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "app.js"), "export const app = true;\n");

  const forge = createContextForge(tempRoot, { sessionId: `startup_lock_${Date.now()}` });
  const lockDbPath = path.join(tempRoot, ".contextforge", "contextforge.db");
  const lockDb = new DatabaseSync(lockDbPath);

  try {
    forge._writeRepositoryRow({
      fileCount: 2,
      indexedFileCount: 0,
      indexStatus: "warming",
      pendingDerivedState: 1,
      batchSize: 1
    });
    forge._deferredIndexState = {
      status: "warming",
      estimatedFileCount: 2,
      syncReason: "startup"
    };
    lockDb.exec("BEGIN IMMEDIATE");
    const startup = forge.startup("check index status");
    assert.ok(startup.index);
    assert.equal(startup.index.deferred, true);
    assert.equal(startup.pagePersistence, "deferred_due_to_lock");
  } finally {
    lockDb.exec("ROLLBACK");
    lockDb.close();
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("indexRepository can batch file ingestion into one persistent index", () => {
  const previousBatchSize = process.env.CONTEXTFORGE_INDEX_BATCH_SIZE;
  process.env.CONTEXTFORGE_INDEX_BATCH_SIZE = "1";
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-batched-index-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "batched-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "README.md"), "# Batched fixture\n");
  fs.writeFileSync(path.join(tempRoot, "src", "app.js"), "export const app = true;\n");
  fs.writeFileSync(path.join(tempRoot, "src", "worker.js"), "export const worker = true;\n");

  const forge = createContextForge(tempRoot, { sessionId: `batched_index_${Date.now()}` });
  try {
    const summary = forge.indexRepository();
    assert.equal(summary.batchSize, 1);
    assert.ok(summary.batchCount >= 4);
    assert.equal(summary.indexStatus, "ready");
    assert.ok(summary.filesIndexed >= 4);
    assert.ok(summary.contentCoverage.complete);
    assert.ok(summary.contentCoverage.indexedLineCount > 0);

    const reused = forge.indexRepository();
    assert.equal(reused.reusedIndex, true);
    assert.equal(reused.indexStatus, "ready");
    assert.equal(reused.batchSize, 1);
    assert.ok(reused.contentCoverage.complete);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousBatchSize == null) {
      delete process.env.CONTEXTFORGE_INDEX_BATCH_SIZE;
    } else {
      process.env.CONTEXTFORGE_INDEX_BATCH_SIZE = previousBatchSize;
    }
  }
});

test("forge_walk stays usable immediately after deferred startup", () => {
  const previousThreshold = process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD;
  process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD = "1";
  const tempRoot = fs.mkdtempSync(path.join(writableTempBase(), "contextforge-deferred-walk-"));
  fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "package.json"), JSON.stringify({ name: "deferred-walk-fixture", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(tempRoot, "src", "app.js"), "export const app = true;\n");
  fs.writeFileSync(path.join(tempRoot, "src", "worker.js"), "export const worker = true;\n");
  fs.writeFileSync(path.join(tempRoot, "README.md"), "# Deferred walk fixture\n");
  const forge = createContextForge(tempRoot, { sessionId: `deferred_walk_${Date.now()}` });

  try {
    const startup = forge.startup("exhaustive full repository walk - every file, folder, subfolder");
    assert.match(startup.index.status, /queued|warming/);
    const walk = forge.walk("Go through every single file, folder, and subfolder in this project.");
    assert.equal(walk.mode, "exhaustive_walk");
    assert.ok(walk.audit.fileCountInspected >= 4);
  } finally {
    forge.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousThreshold == null) {
      delete process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD;
    } else {
      process.env.CONTEXTFORGE_STARTUP_DEFER_THRESHOLD = previousThreshold;
    }
  }
});
