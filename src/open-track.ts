import path from "node:path";
import { performance } from "node:perf_hooks";
import { createContextForge } from "./contextforge.js";
import { loadRepositoryFiles } from "./indexing/files.js";
import { loadOpenTrackReport } from "./reports.js";
import { recordSessionEvent } from "./session/events.js";
import { readText } from "./utils/fs.js";
import { resolveProjectPath } from "./utils/runtime-paths.js";
import { estimateTokens, tokenize, unique, clip } from "./utils/text.js";

const FIXTURE_ROOT = resolveProjectPath(import.meta.url, "benchmark");
const EXTERNAL_BASELINES = ["context_mode", "token_savior"];
const BUILT_IN_BASELINES = ["bare_workflow", "contextforge"];
const EPSILON = 1e-9;

export async function runOpenTrack(rootDir): Promise<any> {
  await primeIndexedRepo(rootDir);
  const fixtures = loadPhase3Fixtures();
  const builtIns = await Promise.all([
    runBareWorkflowBaseline(rootDir, fixtures),
    runContextForgeBaseline(rootDir, fixtures)
  ]);
  const imported = EXTERNAL_BASELINES.map((name) => loadImportedBaselineReport(name)).filter(Boolean);
  const unavailable = EXTERNAL_BASELINES
    .filter((name) => !imported.some((baseline) => baseline.name === name))
    .map((name) => unavailableBaseline(name));

  const baselines = orderBaselines([...builtIns, ...imported, ...unavailable]).map((baseline) => ({
    ...baseline,
    summary: baseline.summary ?? (baseline.suites ? summarizeBaseline(baseline.suites) : null)
  }));
  const availableBaselines = baselines.filter((baseline) => baseline.available);
  const summary = summarizeTrack(availableBaselines);
  const releaseGates = evaluateReleaseGates(baselines, summary);

  return {
    rootDir: path.resolve(rootDir),
    generatedAt: new Date().toISOString(),
    fixtures: {
      startup: fixtures.startup.length,
      compression: fixtures.compression.length,
      retrieval: fixtures.retrieval.length,
      session: fixtures.session.length,
      endToEnd: fixtures.endToEnd.length
    },
    baselines,
    summary,
    releaseGates
  };
}

export async function runReleaseGates(rootDir): Promise<any> {
  const report = await runOpenTrack(rootDir);
  return report.releaseGates;
}

function loadPhase3Fixtures() {
  return {
    startup: loadFixture("startup/scenarios.json"),
    compression: loadFixture("compression/scenarios.json"),
    retrieval: loadFixture("retrieval/scenarios.json"),
    session: loadFixture("session/scenarios.json"),
    endToEnd: loadFixture("end-to-end/local-tasks.json")
  };
}

function loadFixture(relativePath) {
  const filePath = path.join(FIXTURE_ROOT, relativePath);
  return JSON.parse(readText(filePath));
}

function loadImportedBaselineReport(name) {
  return loadOpenTrackReport(name);
}

function unavailableBaseline(name) {
  return {
    name,
    available: false,
    source: "not_configured",
    summary: null,
    suites: null,
    notes: [
      `Import ${name}.report.json into benchmark/open-track/ to include this baseline in the open track.`
    ]
  };
}

async function runContextForgeBaseline(rootDir, fixtures) {
  return {
    name: "contextforge",
    available: true,
    source: "built_in",
    suites: {
      startup: await runContextForgeStartupSuite(rootDir, fixtures.startup),
      compression: await runContextForgeCompressionSuite(rootDir, fixtures.compression),
      retrieval: await runContextForgeRetrievalSuite(rootDir, fixtures.retrieval),
      session: await runContextForgeSessionSuite(rootDir, fixtures.session),
      endToEnd: await runContextForgeEndToEndSuite(rootDir, fixtures.endToEnd)
    },
    summary: null
  };
}

async function primeIndexedRepo(rootDir) {
  const forge = createContextForge(rootDir, { sessionId: "open_track_prime" });
  try {
    forge.indexRepository();
  } finally {
    forge.close();
  }
}

async function runBareWorkflowBaseline(rootDir, fixtures) {
  return {
    name: "bare_workflow",
    available: true,
    source: "built_in",
    suites: {
      startup: runBareStartupSuite(rootDir, fixtures.startup),
      compression: runBareCompressionSuite(fixtures.compression),
      retrieval: runBareRetrievalSuite(rootDir, fixtures.retrieval),
      session: runBareSessionSuite(rootDir, fixtures.session),
      endToEnd: runBareEndToEndSuite(rootDir, fixtures.endToEnd)
    },
    summary: null
  };
}

async function runContextForgeStartupSuite(rootDir, scenarios) {
  const tasks = [];
  for (const scenario of scenarios) {
    const forge = createContextForge(rootDir);
    const start = performance.now();
    try {
      const result = forge.startup(scenario.message);
      const charBudget = result.pages.reduce((sum, page) => sum + (page.sizeEstimate ?? 0), 0);
      tasks.push({
        id: scenario.id,
        message: scenario.message,
        taskLabel: result.task.label,
        loadStrategy: result.task.loadStrategy,
        tokensBeforeUsefulAction: tokensFromChars(charBudget),
        filesRead: 0,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return {
    tasks,
    avgTokensBeforeUsefulAction: average(tasks.map((task) => task.tokensBeforeUsefulAction)),
    avgLatencyMs: average(tasks.map((task) => task.latencyMs)),
    avgFilesRead: average(tasks.map((task) => task.filesRead))
  };
}

async function runContextForgeCompressionSuite(rootDir, scenarios) {
  const tasks = [];
  for (const scenario of scenarios) {
    const forge = createContextForge(rootDir);
    const start = performance.now();
    try {
      const result = await forge.processArtifact(scenario.content, { filePath: scenario.filePath });
      tasks.push({
        id: scenario.id,
        contentType: result.contentType,
        fidelityOk: result.fidelity?.ok ?? true,
        rawTokens: estimateTokens(scenario.content),
        compressedTokens: estimateTokens(result.output),
        tokenReduction: ratioReduction(scenario.content, result.output),
        route: result.route,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return {
    tasks,
    fidelityRate: average(tasks.map((task) => task.fidelityOk ? 1 : 0)),
    avgTokenReduction: average(tasks.map((task) => task.tokenReduction)),
    avgLatencyMs: average(tasks.map((task) => task.latencyMs))
  };
}

async function runContextForgeRetrievalSuite(rootDir, scenarios) {
  const tasks = [];
  for (const scenario of scenarios) {
    const forge = createContextForge(rootDir);
    const start = performance.now();
    try {
      forge.indexRepository();
      injectSessionEvents(forge, scenario.setupEvents ?? []);
      const output = executeContextForgeTask(forge, scenario);
      const evaluation = evaluateScenario(scenario, output);
      tasks.push({
        id: scenario.id,
        query: scenario.query,
        kind: scenario.kind,
        success: evaluation.success,
        rank: evaluation.rank,
        topLabel: output.labels[0] ?? null,
        tokensToCorrectAnswer: evaluation.tokensToCorrectAnswer,
        filesRead: output.filesRead,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return summarizeRetrievalLike(tasks);
}

async function runContextForgeSessionSuite(rootDir, scenarios) {
  const tasks = [];
  for (const scenario of scenarios) {
    const forge = createContextForge(rootDir);
    const start = performance.now();
    try {
      forge.indexRepository();
      injectSessionEvents(forge, scenario.setupEvents ?? []);
      const output = executeContextForgeTask(forge, scenario);
      const evaluation = evaluateScenario(scenario, output);
      tasks.push({
        id: scenario.id,
        query: scenario.query ?? null,
        kind: scenario.kind,
        success: evaluation.success,
        sessionCount: output.sessionCount,
        falseCausalLink: evaluation.falseCausalLink,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return summarizeSessionSuite(tasks);
}

async function runContextForgeEndToEndSuite(rootDir, tasks) {
  const runs = [];
  for (const task of tasks) {
    const forge = createContextForge(rootDir);
    const start = performance.now();
    try {
      forge.indexRepository();
      const startup = forge.startup(task.query);
      injectSessionEvents(forge, task.setupEvents ?? []);
      const output = executeContextForgeTask(forge, task);
      const evaluation = evaluateScenario(task, output);
      runs.push({
        id: task.id,
        kind: task.kind,
        success: evaluation.success,
        startupTokens: tokensFromChars(startup.pages.reduce((sum, page) => sum + (page.sizeEstimate ?? 0), 0)),
        steadyStateTokens: evaluation.tokensToCorrectAnswer,
        totalTokens: evaluation.tokensToCorrectAnswer + tokensFromChars(startup.pages.reduce((sum, page) => sum + (page.sizeEstimate ?? 0), 0)),
        filesRead: output.filesRead,
        latencyMs: toMs(start)
      });
    } finally {
      forge.close();
    }
  }

  return summarizeEndToEndSuite(runs);
}

function runBareStartupSuite(rootDir, scenarios) {
  const runner = new BareWorkflowRunner(rootDir);
  const tasks = scenarios.map((scenario) => runner.startupScenario(scenario));
  return {
    tasks,
    avgTokensBeforeUsefulAction: average(tasks.map((task) => task.tokensBeforeUsefulAction)),
    avgLatencyMs: average(tasks.map((task) => task.latencyMs)),
    avgFilesRead: average(tasks.map((task) => task.filesRead))
  };
}

function runBareCompressionSuite(scenarios) {
  const tasks = scenarios.map((scenario) => ({
    id: scenario.id,
    fidelityOk: true,
    rawTokens: estimateTokens(scenario.content),
    compressedTokens: estimateTokens(scenario.content),
    tokenReduction: 0,
    route: "exact",
    latencyMs: 0
  }));
  return {
    tasks,
    fidelityRate: 1,
    avgTokenReduction: 0,
    avgLatencyMs: 0
  };
}

function runBareRetrievalSuite(rootDir, scenarios) {
  const runner = new BareWorkflowRunner(rootDir);
  const tasks = scenarios.map((scenario) => {
    runner.resetSession();
    runner.injectEvents(scenario.setupEvents ?? []);
    const start = performance.now();
    const output = runner.executeTask(scenario);
    const evaluation = evaluateScenario(scenario, output);
    return {
      id: scenario.id,
      query: scenario.query,
      kind: scenario.kind,
      success: evaluation.success,
      rank: evaluation.rank,
      topLabel: output.labels[0] ?? null,
      tokensToCorrectAnswer: evaluation.tokensToCorrectAnswer,
      filesRead: output.filesRead,
      latencyMs: toMs(start)
    };
  });

  return summarizeRetrievalLike(tasks);
}

function runBareSessionSuite(rootDir, scenarios) {
  const runner = new BareWorkflowRunner(rootDir);
  const tasks = scenarios.map((scenario) => {
    runner.resetSession();
    runner.injectEvents(scenario.setupEvents ?? []);
    const start = performance.now();
    const output = runner.executeTask(scenario);
    const evaluation = evaluateScenario(scenario, output);
    return {
      id: scenario.id,
      query: scenario.query ?? null,
      kind: scenario.kind,
      success: evaluation.success,
      sessionCount: output.sessionCount,
      falseCausalLink: evaluation.falseCausalLink,
      latencyMs: toMs(start)
    };
  });

  return summarizeSessionSuite(tasks);
}

function runBareEndToEndSuite(rootDir, tasks) {
  const runner = new BareWorkflowRunner(rootDir);
  const runs = tasks.map((task) => {
    runner.resetSession();
    runner.injectEvents(task.setupEvents ?? []);
    const startup = runner.startupScenario({
      ...task,
      message: task.query,
      expectedFiles: []
    });
    const start = performance.now();
    const output = runner.executeTask(task);
    const evaluation = evaluateScenario(task, output);
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
    case "why": {
      const result = forge.why(task.query);
      return normalizeStructuredOutput(result);
    }
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

function normalizeListOutput(items: any[], extra: Record<string, any> = {}): any {
  const labels = items.map((item) => item.label).filter(Boolean);
  return {
    labels,
    graphLabels: [],
    sessionCount: extra.sessionCount ?? 0,
    filesRead: unique(items.map((item) => item.fileRef).filter(Boolean)).length,
    rawTokens: sum(items.map((item) => estimateTokens(item.label)))
  };
}

interface BareWorkflowRunner {
  rootDir: string;
  files: any[];
  symbols: any[];
  sessionEvents: any[];
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

function evaluateScenario(task, output) {
  const labels = output.labels ?? [];
  const graphLabels = output.graphLabels ?? [];
  const rank = computeRank(task, labels, graphLabels);
  const success = computeSuccess(task, labels, graphLabels, output);
  return {
    success,
    rank,
    tokensToCorrectAnswer: computeTokensToCorrectAnswer(task, output, rank),
    falseCausalLink: task.kind === "why" && !success && (graphLabels.length > 0 || output.sessionCount > 0) ? 1 : 0
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

function summarizeRetrievalLike(tasks) {
  return {
    tasks,
    hitAt1: average(tasks.map((task) => task.rank === 1 ? 1 : 0)),
    hitAt5: average(tasks.map((task) => task.rank && task.rank <= 5 ? 1 : 0)),
    mrr: average(tasks.map((task) => task.rank ? 1 / task.rank : 0)),
    avgTokensToCorrectAnswer: average(tasks.map((task) => task.tokensToCorrectAnswer)),
    avgFilesRead: average(tasks.map((task) => task.filesRead)),
    avgLatencyMs: average(tasks.map((task) => task.latencyMs))
  };
}

function summarizeSessionSuite(tasks) {
  return {
    tasks,
    recallAtK: average(tasks.map((task) => task.success ? 1 : 0)),
    correctnessRate: average(tasks.map((task) => task.success ? 1 : 0)),
    falseCausalLinkRate: average(tasks.map((task) => task.falseCausalLink)),
    avgLatencyMs: average(tasks.map((task) => task.latencyMs))
  };
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

function summarizeTrack(baselines) {
  return {
    baselines: baselines.map((baseline) => ({
      name: baseline.name,
      source: baseline.source,
      summary: baseline.summary
    })),
    winners: {
      startup: winnerForMetric(baselines, (summary) => summary.startup?.avgTokensBeforeUsefulAction, "min"),
      compression: compressionWinner(baselines),
      retrieval: retrievalWinner(baselines),
      endToEnd: endToEndWinner(baselines)
    }
  };
}

function summarizeBaseline(suites) {
  return {
    startup: pickSuiteMetrics(suites.startup, ["avgTokensBeforeUsefulAction", "avgLatencyMs", "avgFilesRead"]),
    compression: pickSuiteMetrics(suites.compression, ["fidelityRate", "avgTokenReduction", "avgLatencyMs"]),
    retrieval: pickSuiteMetrics(suites.retrieval, ["hitAt1", "hitAt5", "mrr", "avgTokensToCorrectAnswer", "avgFilesRead", "avgLatencyMs"]),
    session: pickSuiteMetrics(suites.session, ["recallAtK", "correctnessRate", "falseCausalLinkRate", "avgLatencyMs"]),
    endToEnd: pickSuiteMetrics(suites.endToEnd, ["successRate", "tokensPerSuccessfulTask", "startupCost", "steadyStateCost", "filesReadPerSuccessfulTask", "avgLatencyMs"])
  };
}

function pickSuiteMetrics(suite, keys) {
  return Object.fromEntries(keys.map((key) => [key, suite?.[key] ?? null]));
}

function evaluateReleaseGates(baselines, summary) {
  const availableNames = baselines.filter((baseline) => baseline.available).map((baseline) => baseline.name);
  const missingBaselines = ["bare_workflow", "context_mode", "token_savior", "contextforge"].filter((name) => !availableNames.includes(name));
  const contextforge = baselines.find((baseline) => baseline.name === "contextforge" && baseline.available);
  const contextforgeSummary = contextforge?.summary ?? (contextforge?.suites ? summarizeBaseline(contextforge.suites) : null);

  const startupWinner = summary?.winners?.startup?.name ?? null;
  const compressionWinnerName = summary?.winners?.compression?.name ?? null;
  const retrievalWinner = summary?.winners?.retrieval?.name ?? null;
  const endToEndWinner = summary?.winners?.endToEnd?.name ?? null;

  const fidelityLeaders = highestFidelityBaselines(baselines);
  const compressionPass = fidelityLeaders.includes("contextforge") &&
    (contextforgeSummary?.compression?.avgTokenReduction ?? 0) > 0;

  const gates = {
    trackReady: {
      status: missingBaselines.length ? "incomplete" : "ready",
      missingBaselines
    },
    startup: {
      status: !contextforgeSummary ? "unavailable" : startupWinner === "contextforge" ? "pass" : "fail",
      bestBaseline: startupWinner,
      contextforgeValue: contextforgeSummary?.startup?.avgTokensBeforeUsefulAction ?? null
    },
    compression: {
      status: !contextforgeSummary ? "unavailable" : compressionPass ? "pass" : "fail",
      bestBaseline: compressionWinnerName,
      fidelityLeaders,
      contextforgeValue: contextforgeSummary?.compression?.fidelityRate ?? null
    },
    retrieval: {
      status: !contextforgeSummary ? "unavailable" : retrievalWinner === "contextforge" ? "pass" : "fail",
      bestBaseline: retrievalWinner,
      contextforgeValue: contextforgeSummary?.retrieval?.avgTokensToCorrectAnswer ?? null
    },
    endToEnd: {
      status: !contextforgeSummary ? "unavailable" : endToEndWinner === "contextforge" ? "pass" : "fail",
      bestBaseline: endToEndWinner,
      contextforgeValue: contextforgeSummary?.endToEnd?.tokensPerSuccessfulTask ?? null
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

function winnerForMetric(baselines, getter, direction) {
  const candidates = baselines
    .map((baseline) => ({
      name: baseline.name,
      value: getter(baseline.summary)
    }))
    .filter((candidate) => typeof candidate.value === "number" && Number.isFinite(candidate.value));

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    if (direction === "min") {
      return candidate.value < best.value - EPSILON ? candidate : best;
    }

    return candidate.value > best.value + EPSILON ? candidate : best;
  }, null);
}

function compressionWinner(baselines) {
  const candidates = baselines
    .map((baseline) => ({
      name: baseline.name,
      fidelityRate: baseline.summary?.compression?.fidelityRate ?? null,
      avgTokenReduction: baseline.summary?.compression?.avgTokenReduction ?? null
    }))
    .filter((candidate) => typeof candidate.fidelityRate === "number");

  if (!candidates.length) {
    return null;
  }

  return candidates.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    if (candidate.fidelityRate > best.fidelityRate + EPSILON) {
      return candidate;
    }

    if (Math.abs(candidate.fidelityRate - best.fidelityRate) <= EPSILON &&
      (candidate.avgTokenReduction ?? 0) > (best.avgTokenReduction ?? 0) + EPSILON) {
      return candidate;
    }

    return best;
  }, null);
}

function highestFidelityBaselines(baselines) {
  const available = baselines.filter((baseline) => baseline.available && typeof baseline.summary?.compression?.fidelityRate === "number");
  if (!available.length) {
    return [];
  }

  const maxFidelity = Math.max(...available.map((baseline) => baseline.summary.compression.fidelityRate));
  return available
    .filter((baseline) => Math.abs(baseline.summary.compression.fidelityRate - maxFidelity) <= EPSILON)
    .map((baseline) => baseline.name);
}

function retrievalWinner(baselines) {
  const available = baselines.filter((baseline) => baseline.available && baseline.summary?.retrieval);
  if (!available.length) {
    return null;
  }

  return available.reduce((best, baseline) => {
    const current = baseline.summary.retrieval;
    const candidate = {
      name: baseline.name,
      hitAt1: current.hitAt1 ?? 0,
      hitAt5: current.hitAt5 ?? 0,
      mrr: current.mrr ?? 0,
      value: current.avgTokensToCorrectAnswer ?? Number.POSITIVE_INFINITY
    };

    if (!best) {
      return candidate;
    }

    if (candidate.hitAt1 > best.hitAt1 + EPSILON) {
      return candidate;
    }

    if (Math.abs(candidate.hitAt1 - best.hitAt1) <= EPSILON && candidate.hitAt5 > best.hitAt5 + EPSILON) {
      return candidate;
    }

    if (Math.abs(candidate.hitAt1 - best.hitAt1) <= EPSILON &&
      Math.abs(candidate.hitAt5 - best.hitAt5) <= EPSILON &&
      candidate.mrr > best.mrr + EPSILON) {
      return candidate;
    }

    if (Math.abs(candidate.hitAt1 - best.hitAt1) <= EPSILON &&
      Math.abs(candidate.hitAt5 - best.hitAt5) <= EPSILON &&
      Math.abs(candidate.mrr - best.mrr) <= EPSILON &&
      candidate.value < best.value - EPSILON) {
      return candidate;
    }

    return best;
  }, null);
}

function endToEndWinner(baselines) {
  const available = baselines.filter((baseline) => baseline.available && baseline.summary?.endToEnd);
  if (!available.length) {
    return null;
  }

  return available.reduce((best, baseline) => {
    const current = baseline.summary.endToEnd;
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

function orderBaselines(baselines) {
  const order = ["bare_workflow", "context_mode", "token_savior", "contextforge"];
  return [...baselines].sort((left, right) => order.indexOf(left.name) - order.indexOf(right.name));
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
    })), { sessionCount: 0 });
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
      ...this.files.filter((file) => file.content.includes(query) || lexicalScore(file.relativePath, query) > 0).map((file) => file.relativePath)
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

function ratioReduction(original, compressed) {
  const raw = estimateTokens(original);
  const out = estimateTokens(compressed);
  return raw > 0 ? 1 - (out / raw) : 0;
}

function tokensFromChars(charCount) {
  return Math.ceil((charCount ?? 0) / 4);
}

function toMs(start) {
  return Number((performance.now() - start).toFixed(2));
}
