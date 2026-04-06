import path from "node:path";
import { performance } from "node:perf_hooks";
import { createContextForge } from "./contextforge.js";
import { loadRepositoryFiles } from "./indexing/files.js";
import { runOpenTrack } from "./open-track.js";
import { loadClosedTrackReport } from "./reports.js";
import { recordSessionEvent } from "./session/events.js";
import { exists, readText } from "./utils/fs.js";
import { resolveProjectPath } from "./utils/runtime-paths.js";
import { estimateTokens, tokenize, unique, clip } from "./utils/text.js";

const BENCH_ROOT = resolveProjectPath(import.meta.url, "benchmark");
const CLOSED_BASELINES = [];
const EPSILON = 1e-9;

export async function runPhase3(rootDir) {
  await primeIndexedRepo(rootDir);
  const openTrack = await runOpenTrack(rootDir);
  const swebench = await runSweBenchSubset(rootDir);
  const closedTrack = await runClosedTrack(rootDir);

  return {
    rootDir: path.resolve(rootDir),
    generatedAt: new Date().toISOString(),
    openTrack,
    swebench,
    closedTrack,
    phaseStatus: evaluatePhase3Status(openTrack, swebench, closedTrack)
  };
}

export async function runSweBenchSubset(rootDir) {
  await primeIndexedRepo(rootDir);
  const tasks = loadFixture("swebench/subset.json");
  const baselines = [
    await runContextForgeBaseline(rootDir, tasks, "swebenchSubset"),
    runBareBaseline(rootDir, tasks, "swebenchSubset")
  ];
  const summary = summarizeComparableTrack(baselines, "swebenchSubset");

  return {
    rootDir: path.resolve(rootDir),
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    baselines,
    summary,
    gates: {
      overallStatus: summary.winner?.name === "contextforge" ? "pass" : "fail",
      bestBaseline: summary.winner?.name ?? null,
      contextforgeValue: baselines.find((baseline) => baseline.name === "contextforge")?.summary?.swebenchSubset?.tokensPerSuccessfulTask ?? null
    }
  };
}

export async function runClosedTrack(rootDir) {
  await primeIndexedRepo(rootDir);
  const localTasks = loadFixture("end-to-end/local-tasks.json");
  const swebenchTasks = loadFixture("swebench/subset.json");

  const contextforge = {
    name: "contextforge",
    available: true,
    source: "built_in",
    summary: {
      localVerified: await runContextForgeSuite(rootDir, localTasks),
      swebenchSubset: await runContextForgeSuite(rootDir, swebenchTasks)
    },
    notes: []
  };

  const imported = CLOSED_BASELINES
    .map((name) => loadClosedBaselineReport(name))
    .filter(Boolean);
  const unavailable = CLOSED_BASELINES
    .filter((name) => !imported.some((baseline) => baseline.name === name))
    .map((name) => ({
      name,
      available: false,
      source: "not_configured",
      summary: null,
      notes: [
        `Import ${name}.report.json into benchmark/closed-track/ to include this black-box baseline.`
      ]
    }));

  const baselines = orderClosedBaselines([...imported, ...unavailable, contextforge]);
  const available = baselines.filter((baseline) => baseline.available);
  const summary = summarizeClosedTrack(available);
  const releaseGates = evaluateClosedTrackGates(baselines, summary);

  return {
    rootDir: path.resolve(rootDir),
    generatedAt: new Date().toISOString(),
    mode: "concept_only",
    taskCounts: {
      localVerified: localTasks.length,
      swebenchSubset: swebenchTasks.length
    },
    baselines,
    summary,
    releaseGates
  };
}

function loadFixture(relativePath) {
  return JSON.parse(readText(path.join(BENCH_ROOT, relativePath)));
}

function loadClosedBaselineReport(name) {
  return loadClosedTrackReport(name);
}

async function primeIndexedRepo(rootDir) {
  const forge = createContextForge(rootDir, { sessionId: "phase3_prime" });
  try {
    forge.indexRepository();
  } finally {
    forge.close();
  }
}

async function runContextForgeBaseline(rootDir, tasks, suiteName) {
  return {
    name: "contextforge",
    available: true,
    source: "built_in",
    summary: {
      [suiteName]: await runContextForgeSuite(rootDir, tasks)
    },
    notes: []
  };
}

function runBareBaseline(rootDir, tasks, suiteName) {
  return {
    name: "bare_workflow",
    available: true,
    source: "built_in",
    summary: {
      [suiteName]: runBareSuite(rootDir, tasks)
    },
    notes: []
  };
}

async function runContextForgeSuite(rootDir, tasks) {
  const runs = [];

  for (const task of tasks) {
    const forge = createContextForge(rootDir);
    const start = performance.now();

    try {
      forge.indexRepository();
      const startup = forge.startup(task.query ?? task.issue ?? "");
      injectSessionEvents(forge, task.setupEvents ?? []);
      const output = executeContextForgeTask(forge, task);
      const evaluation = evaluateTask(task, output);

      runs.push({
        id: task.id,
        kind: task.kind,
        success: evaluation.success,
        startupTokens: tokensFromChars(sum(startup.pages.map((page) => page.sizeEstimate ?? 0))),
        steadyStateTokens: evaluation.tokensToCorrectAnswer,
        totalTokens: tokensFromChars(sum(startup.pages.map((page) => page.sizeEstimate ?? 0))) + evaluation.tokensToCorrectAnswer,
        filesRead: output.filesRead,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return summarizeEndToEndSuite(runs);
}

function runBareSuite(rootDir, tasks) {
  const runner = new BareWorkflowRunner(rootDir);
  const runs = tasks.map((task) => {
    runner.resetSession();
    runner.injectEvents(task.setupEvents ?? []);
    const startup = runner.startupScenario({
      id: task.id,
      message: task.query ?? task.issue ?? "",
      expectedFiles: task.expectedFiles ?? []
    });
    const start = performance.now();
    const output = runner.executeTask(task);
    const evaluation = evaluateTask(task, output);

    return {
      id: task.id,
      kind: task.kind,
      success: evaluation.success,
      startupTokens: startup.tokensBeforeUsefulAction,
      steadyStateTokens: evaluation.tokensToCorrectAnswer,
      totalTokens: startup.tokensBeforeUsefulAction + evaluation.tokensToCorrectAnswer,
      filesRead: output.filesRead + startup.filesRead,
      latencyMs: toMs(start)
    };
  });

  return summarizeEndToEndSuite(runs);
}

function executeContextForgeTask(forge, task) {
  switch (task.kind) {
    case "symbol": {
      const results = forge.symbol(task.query, { limit: 5 });
      return normalizeListOutput(results.map((result) => ({
        label: result.canonicalName ?? result.label,
        fileRef: result.fileId
      })));
    }
    case "search": {
      const results = forge.search(task.query, { limit: 5 });
      return normalizeListOutput(results.map((result) => ({
        label: result.label,
        fileRef: result.fileId ?? result.id
      })));
    }
    case "scope": {
      const results = forge.scope(task.query, "auto");
      return normalizeListOutput(results.map((result) => ({
        label: result.label,
        fileRef: result.fileId ?? result.id
      })));
    }
    case "impact": {
      const results = forge.impact(task.query);
      return normalizeListOutput(results.map((result) => ({
        label: result.canonicalName,
        fileRef: result.fileId
      })));
    }
    case "why":
      return normalizeStructuredOutput(forge.why(task.query));
    case "session": {
      const results = forge.session(task.query);
      return normalizeListOutput(results.map((result) => ({
        label: `${result.eventType}:${clip(JSON.stringify(result.payload), 160)}`,
        fileRef: result.payload?.filePath ?? null
      })), { sessionCount: results.length });
    }
    case "resume": {
      const result = forge.resume();
      return {
        labels: [result.summary],
        graphLabels: [],
        sessionCount: result.count,
        filesRead: 0,
        rawTokens: estimateTokens(result.summary)
      };
    }
    default:
      return normalizeListOutput([]);
  }
}

function injectSessionEvents(forge, events) {
  for (const event of events) {
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: event.eventType,
      payload: event.payload
    });
  }
}

function normalizeListOutput(items, extra = {}) {
  const labels = items.map((item) => item.label).filter(Boolean);
  return {
    labels,
    graphLabels: [],
    sessionCount: extra.sessionCount ?? 0,
    filesRead: unique(items.map((item) => item.fileRef).filter(Boolean)).length,
    rawTokens: sum(items.map((item) => estimateTokens(item.label)))
  };
}

function normalizeStructuredOutput(result) {
  const seedLabels = (result.seeds ?? []).map((item) => item.label);
  const graphLabels = (result.graph ?? []).map((item) => item.label);
  const sessionLabels = (result.session ?? []).map((item) => `${item.eventType}:${clip(JSON.stringify(item.payload), 160)}`);
  const fileRefs = unique([
    ...(result.session ?? []).map((item) => item.payload?.filePath).filter(Boolean),
    ...graphLabels.filter((label) => label.includes("/"))
  ]);

  return {
    labels: [...seedLabels, ...graphLabels, ...sessionLabels],
    graphLabels,
    sessionLabels,
    sessionCount: (result.session ?? []).length,
    filesRead: fileRefs.length,
    rawTokens: estimateTokens(JSON.stringify(result)),
    summaryLabel: result.summary ?? null
  };
}

function evaluateTask(task, output) {
  const labels = output.labels ?? [];
  const graphLabels = output.graphLabels ?? [];
  const rank = computeRank(task, labels, graphLabels);
  const success = computeSuccess(task, labels, graphLabels, output);

  return {
    success,
    rank,
    tokensToCorrectAnswer: computeTokensToCorrectAnswer(task, output, rank)
  };
}

function computeSuccess(task, labels, graphLabels, output) {
  if (task.expectedTop) {
    return Boolean(labels[0] && labels[0].includes(task.expectedTop));
  }

  if (task.expectedIncludes) {
    return task.expectedIncludes.every((expected) => labels.some((label) => label.includes(expected)));
  }

  if (task.expectedAny) {
    return task.expectedAny.some((expected) => labels.slice(0, 5).some((label) => label.includes(expected)));
  }

  if (task.expectedGraphIncludes) {
    return task.expectedGraphIncludes.some((expected) => graphLabels.some((label) => label.includes(expected)));
  }

  if (task.expectedSummaryIncludes) {
    return task.expectedSummaryIncludes.every((expected) => labels[0]?.includes(expected));
  }

  if (task.expectedSessionMin != null) {
    return (output.sessionCount ?? 0) >= task.expectedSessionMin;
  }

  return false;
}

function computeRank(task, labels, graphLabels) {
  if (task.expectedTop) {
    return labels[0]?.includes(task.expectedTop) ? 1 : null;
  }

  if (task.expectedIncludes) {
    const ranks = task.expectedIncludes
      .map((expected) => labels.findIndex((label) => label.includes(expected)))
      .filter((index) => index >= 0)
      .map((index) => index + 1);
    return ranks.length ? Math.min(...ranks) : null;
  }

  if (task.expectedAny) {
    const rank = labels.findIndex((label) => task.expectedAny.some((expected) => label.includes(expected)));
    return rank >= 0 ? rank + 1 : null;
  }

  if (task.expectedGraphIncludes) {
    const rank = graphLabels.findIndex((label) => task.expectedGraphIncludes.some((expected) => label.includes(expected)));
    return rank >= 0 ? rank + 1 : null;
  }

  return null;
}

function computeTokensToCorrectAnswer(task, output, rank) {
  if (task.kind === "session" || task.kind === "resume") {
    return output.rawTokens ?? 0;
  }

  if (task.expectedSessionMin != null) {
    const sessionLabels = output.sessionLabels ?? [];
    if (sessionLabels.length) {
      return sum(sessionLabels.slice(0, task.expectedSessionMin).map((label) => estimateTokens(label)));
    }

    return output.summaryLabel ? estimateTokens(output.summaryLabel) : (output.rawTokens ?? 0);
  }

  if (task.kind === "why") {
    if (!rank) {
      return output.summaryLabel ? estimateTokens(output.summaryLabel) : (output.rawTokens ?? 0);
    }

    const sourceLabels = output.graphLabels?.length ? output.graphLabels : output.labels ?? [];
    return sum(sourceLabels.slice(0, rank).map((label) => estimateTokens(label)));
  }

  if (!rank) {
    return output.rawTokens ?? 0;
  }

  return sum((output.labels ?? []).slice(0, rank).map((label) => estimateTokens(label)));
}

function summarizeEndToEndSuite(tasks) {
  const successful = tasks.filter((task) => task.success);
  return {
    tasks,
    successRate: average(tasks.map((task) => task.success ? 1 : 0)),
    tokensPerSuccessfulTask: successful.length ? average(successful.map((task) => task.totalTokens)) : null,
    startupCost: average(tasks.map((task) => task.startupTokens)),
    steadyStateCost: average(tasks.map((task) => task.steadyStateTokens)),
    filesReadPerSuccessfulTask: successful.length ? average(successful.map((task) => task.filesRead)) : null,
    avgLatencyMs: average(tasks.map((task) => task.latencyMs))
  };
}

function summarizeComparableTrack(baselines, suiteName) {
  const winner = endToEndWinner(baselines, suiteName);
  return {
    baselines: baselines.map((baseline) => ({
      name: baseline.name,
      source: baseline.source,
      summary: baseline.summary[suiteName]
    })),
    winner
  };
}

function summarizeClosedTrack(baselines) {
  return {
    baselines: baselines.map((baseline) => ({
      name: baseline.name,
      source: baseline.source,
      summary: baseline.summary
    })),
    winners: {
      localVerified: endToEndWinner(baselines, "localVerified"),
      swebenchSubset: endToEndWinner(baselines, "swebenchSubset")
    }
  };
}

function evaluateClosedTrackGates(baselines, summary) {
  const availableNames = baselines.filter((baseline) => baseline.available).map((baseline) => baseline.name);
  const missingBaselines = CLOSED_BASELINES.filter((name) => !availableNames.includes(name));
  const contextforge = baselines.find((baseline) => baseline.name === "contextforge" && baseline.available);

  const gates = {
    trackReady: {
      status: missingBaselines.length ? "incomplete" : "ready",
      missingBaselines
    },
    localVerified: {
      status: !contextforge ? "unavailable" : summary?.winners?.localVerified?.name === "contextforge" ? "pass" : "fail",
      bestBaseline: summary?.winners?.localVerified?.name ?? null,
      contextforgeValue: contextforge?.summary?.localVerified?.tokensPerSuccessfulTask ?? null
    },
    swebenchSubset: {
      status: !contextforge ? "unavailable" : summary?.winners?.swebenchSubset?.name === "contextforge" ? "pass" : "fail",
      bestBaseline: summary?.winners?.swebenchSubset?.name ?? null,
      contextforgeValue: contextforge?.summary?.swebenchSubset?.tokensPerSuccessfulTask ?? null
    }
  };

  const allPassed = Object.values(gates)
    .filter((gate) => gate.status !== "ready" && gate.status !== "incomplete")
    .every((gate) => gate.status === "pass");

  return {
    overallStatus: missingBaselines.length ? "incomplete" : allPassed ? "pass" : "fail",
    missingBaselines,
    gates
  };
}

function evaluatePhase3Status(openTrack, swebench, closedTrack) {
  const statuses = [
    openTrack.releaseGates.overallStatus,
    swebench.gates.overallStatus,
    closedTrack.releaseGates.overallStatus
  ];

  return {
    overallStatus: statuses.includes("incomplete") ? "incomplete" : statuses.every((status) => status === "pass") ? "pass" : "fail",
    openTrackStatus: openTrack.releaseGates.overallStatus,
    swebenchStatus: swebench.gates.overallStatus,
    closedTrackStatus: closedTrack.releaseGates.overallStatus
  };
}

function endToEndWinner(baselines, suiteName) {
  const available = baselines
    .filter((baseline) => baseline.available && baseline.summary?.[suiteName]);
  if (!available.length) {
    return null;
  }

  return available.reduce((best, baseline) => {
    const current = baseline.summary[suiteName];
    const candidate = {
      name: baseline.name,
      successRate: current.successRate ?? 0,
      value: current.tokensPerSuccessfulTask ?? Number.POSITIVE_INFINITY
    };

    if (!best) {
      return candidate;
    }

    if (candidate.successRate > best.successRate + EPSILON) {
      return candidate;
    }

    if (Math.abs(candidate.successRate - best.successRate) <= EPSILON && candidate.value < best.value - EPSILON) {
      return candidate;
    }

    return best;
  }, null);
}

function orderClosedBaselines(baselines) {
  const order = ["contextforge"];
  return [...baselines].sort((left, right) => {
    const leftIndex = order.includes(left.name) ? order.indexOf(left.name) : Number.MAX_SAFE_INTEGER;
    const rightIndex = order.includes(right.name) ? order.indexOf(right.name) : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.name.localeCompare(right.name);
  });
}

class BareWorkflowRunner {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
    this.files = loadRepositoryFiles(this.rootDir, "bare_repo");
    this.symbols = collectNaiveSymbols(this.files);
    this.sessionEvents = [];
  }

  resetSession() {
    this.sessionEvents = [];
  }

  injectEvents(events) {
    this.sessionEvents.push(...events.map((event, index) => ({
      id: `${event.eventType}:${index}`,
      eventType: event.eventType,
      payload: event.payload ?? {}
    })));
  }

  startupScenario(task) {
    const start = performance.now();
    if (!task.expectedFiles?.length) {
      return {
        id: task.id,
        message: task.message,
        tokensBeforeUsefulAction: 0,
        filesRead: 0,
        latencyMs: toMs(start)
      };
    }

    const ordered = this.searchFiles(task.message);
    const read = [];
    for (const file of ordered) {
      read.push(file);
      if (task.expectedFiles.some((expected) => expected === file.relativePath)) {
        break;
      }
    }

    return {
      id: task.id,
      message: task.message,
      tokensBeforeUsefulAction: sum(read.map((file) => estimateTokens(file.content))),
      filesRead: read.length,
      latencyMs: toMs(start)
    };
  }

  executeTask(task) {
    switch (task.kind) {
      case "symbol":
        return this.symbol(task.query);
      case "search":
        return this.search(task.query);
      case "scope":
        return this.scope(task.query);
      case "impact":
        return this.impact(task.query);
      case "why":
        return this.why(task.query);
      case "session":
        return this.session(task.query);
      case "resume":
        return this.resume();
      default:
        return normalizeListOutput([]);
    }
  }

  symbol(query) {
    const ranked = this.scoreSymbols(query).slice(0, 8);
    return normalizeListOutput(ranked.map((symbol) => ({
      label: symbol.canonicalName,
      fileRef: symbol.filePath
    })));
  }

  search(query) {
    const rankedSymbols = this.scoreSymbols(query).slice(0, 5);
    if (rankedSymbols.length) {
      return normalizeListOutput(rankedSymbols.map((symbol) => ({
        label: symbol.canonicalName,
        fileRef: symbol.filePath
      })));
    }

    return normalizeListOutput(this.searchFiles(query).slice(0, 5).map((file) => ({
      label: file.relativePath,
      fileRef: file.relativePath
    })));
  }

  scope(query) {
    return normalizeListOutput(this.searchFiles(query).slice(0, 5).map((file) => ({
      label: file.relativePath,
      fileRef: file.relativePath
    })));
  }

  impact(query) {
    const direct = this.scoreSymbols(query).map((symbol) => symbol.filePath);
    const matchingFiles = unique([
      ...direct,
      ...this.files
        .filter((file) => file.content.includes(query) || lexicalScore(file.relativePath, query) > 0)
        .map((file) => file.relativePath)
    ]);

    const impacted = this.symbols
      .filter((symbol) => matchingFiles.includes(symbol.filePath))
      .slice(0, 10);

    return normalizeListOutput(impacted.map((symbol) => ({
      label: symbol.canonicalName,
      fileRef: symbol.filePath
    })));
  }

  why(query) {
    const graph = this.search(query);
    const sessionMatches = this.sessionEvents
      .filter((event) => JSON.stringify(event.payload).toLowerCase().includes(String(query).toLowerCase()))
      .map((event) => ({
        label: `${event.eventType}:${clip(JSON.stringify(event.payload), 160)}`,
        fileRef: event.payload?.filePath ?? null
      }));

    return {
      labels: [...graph.labels, ...sessionMatches.map((entry) => entry.label)],
      graphLabels: graph.labels,
      sessionCount: sessionMatches.length,
      filesRead: this.files.length,
      rawTokens: graph.rawTokens + sum(sessionMatches.map((entry) => estimateTokens(entry.label)))
    };
  }

  session(query) {
    const matches = this.sessionEvents.filter((event) =>
      `${event.eventType} ${JSON.stringify(event.payload)}`.toLowerCase().includes(String(query ?? "").toLowerCase()));

    return normalizeListOutput(matches.map((event) => ({
      label: `${event.eventType}:${clip(JSON.stringify(event.payload), 160)}`,
      fileRef: event.payload?.filePath ?? null
    })), { sessionCount: matches.length });
  }

  resume() {
    const summary = this.sessionEvents
      .map((event) => `- ${event.eventType}: ${clip(JSON.stringify(event.payload), 120)}`)
      .join("\n");
    return {
      labels: [summary],
      graphLabels: [],
      sessionCount: this.sessionEvents.length,
      filesRead: 0,
      rawTokens: estimateTokens(summary)
    };
  }

  searchFiles(query) {
    return this.files
      .map((file) => ({
        ...file,
        score: lexicalScore(`${file.relativePath}\n${file.content}`, query)
      }))
      .filter((file) => file.score > 0)
      .sort((left, right) => right.score - left.score);
  }

  scoreSymbols(query) {
    return this.symbols
      .map((symbol) => ({
        ...symbol,
        score: lexicalScore(`${symbol.canonicalName}\n${symbol.displayName}\n${symbol.body}`, query)
      }))
      .filter((symbol) => symbol.score > 0)
      .sort((left, right) => right.score - left.score);
  }
}

function collectNaiveSymbols(files) {
  const FUNCTION_RE = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const CLASS_RE = /\b(?:export\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const CONST_ARROW_RE = /\b(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/g;

  const symbols = [];
  for (const file of files) {
    for (const regex of [FUNCTION_RE, CLASS_RE, CONST_ARROW_RE]) {
      for (const match of file.content.matchAll(regex)) {
        const name = match[1];
        const start = match.index ?? 0;
        const body = file.content.slice(start, Math.min(file.content.length, start + 280));
        symbols.push({
          displayName: name,
          canonicalName: `${file.relativePath}::${name}`,
          filePath: file.relativePath,
          body
        });
      }
    }
  }

  return symbols;
}

function lexicalScore(text, query) {
  const haystackTokens = new Set(tokenize(text));
  const queryTokens = tokenize(query);
  let score = 0;

  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      score += 1.2;
      continue;
    }

    if ([...haystackTokens].some((candidate) => candidate.includes(token) || token.includes(candidate))) {
      score += 0.6;
    }
  }

  return queryTokens.length ? score / queryTokens.length : 0;
}

function average(values) {
  const usable = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (!usable.length) {
    return null;
  }
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function sum(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function tokensFromChars(charCount) {
  return Math.ceil((charCount ?? 0) / 4);
}

function toMs(start) {
  return Number((performance.now() - start).toFixed(2));
}
