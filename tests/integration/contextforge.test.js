import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { createContextForge } from "../../src/contextforge.js";
import { recordSessionEvent } from "../../src/session/events.js";

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
  const forge = createContextForge(repoRoot, { sessionId: `self_hosted_${Date.now()}` });
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
    assert.ok(walk.audit.answerIfAskedWhetherEveryFileWasRead.includes("Yes."));
    assert.ok(walk.audit.answerIfAskedWhetherWholeProjectWasRead.includes("Yes."));
    assert.ok(walk.audit.answerIfAskedWhetherEveryCornerWasRead.includes("Yes."));
    assert.match(walk.guidance, /exhaustive repository digest/i);
    assert.match(walk.summary, /opened all .* repository files locally/i);

    const routed = forge.understand("Go through every single file, folder, and subfolder in this project.");
    assert.equal(routed.mode, "exhaustive_walk");
  } finally {
    forge.close();
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

    const editResult = forge.edit("notes/todo.md", "beta", "gamma");
    assert.equal(editResult.replacements, 1);
    assert.match(editResult.preview, /gamma/);
    assert.ok(editResult.indexSync.filesIndexed >= 3);
    assert.equal(editResult.indexSync.syncMode, "incremental");

    const bashResult = await forge.bash("pwd");
    assert.equal(bashResult.exitCode, 0);
    assert.match(bashResult.stdoutPreview, /contextforge-fileops-/);
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
    assert.equal(startup.index.status, "queued");
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
