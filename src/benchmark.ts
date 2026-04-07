import path from "node:path";
import { createContextForge } from "./contextforge.js";
import { recordSessionEvent } from "./session/events.js";

const STARTUP_SCENARIOS = [
  "hi",
  "fix typo in auth error message",
  "why is checkout timing out and which files are likely involved?"
];

const SEARCH_QUERIES = [
  "checkout timeout",
  "retry payment",
  "auth middleware",
  "same bug as yesterday"
];

const ALIAS_QUERIES = [
  "authentication credentials",
  "payment backoff"
];

const RAPTOR_QUERIES = [
  "architecture overview of checkout and retry flow",
  "which files are likely involved in checkout timeout"
];

const COMPRESSION_SCENARIOS = [
  {
    name: "log",
    content: [
      "2026-01-01 INFO checkout started",
      "2026-01-01 INFO checkout started",
      "2026-01-01 WARN retry scheduled",
      "2026-01-01 WARN retry scheduled",
      "2026-01-01 ERROR timeout while talking to gateway"
    ].join("\n"),
    metadata: { filePath: "checkout.log" }
  },
  {
    name: "dom_snapshot",
    content: `<button id="checkout-submit" data-testid="checkout-submit" aria-label="Submit order">Submit</button>\n<div class="error">Gateway timeout</div>`,
    metadata: { filePath: "snapshot.html" }
  },
  {
    name: "json_exact",
    content: `{"status":"timeout","attempt":3,"paymentId":"pay_123"}`,
    metadata: { filePath: "response.json" }
  }
];

export async function runBenchmarks(rootDir): Promise<any> {
  const forge = createContextForge(rootDir);
  try {
    const indexSummary = forge.indexRepository();
    const startup = STARTUP_SCENARIOS.map((message) => {
      const start = performance.now();
      const result = forge.startup(message);
      return {
        message,
        label: result.task.label,
        reason: result.task.reason,
        pageCount: result.pages.length,
        durationMs: Number((performance.now() - start).toFixed(2))
      };
    });

    const retrieval = SEARCH_QUERIES.map((query) => {
      const start = performance.now();
      const results = forge.search(query, { limit: 5 });
      return {
        query,
        topResult: results[0]?.label ?? null,
        count: results.length,
        durationMs: Number((performance.now() - start).toFixed(2))
      };
    });

    const alias = ALIAS_QUERIES.map((query) => ({
      query,
      topSymbol: forge.symbol(query, { limit: 3 })[0]?.canonicalName ?? null
    }));

    const raptor = RAPTOR_QUERIES.map((query) => ({
      query,
      plan: forge.planRaptor(query),
      topResult: forge.scope(query, "auto")[0]?.label ?? null
    }));

    const compression = [];
    for (const scenario of COMPRESSION_SCENARIOS) {
      const start = performance.now();
      const result = await forge.processArtifact(scenario.content, scenario.metadata);
      compression.push({
        name: scenario.name,
        contentType: result.contentType,
        route: result.route,
        outputSize: result.output.length,
        durationMs: Number((performance.now() - start).toFixed(2)),
        fidelityOk: result.fidelity?.ok ?? null
      });
    }

    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "edit",
      payload: { filePath: "src/checkout.ts", symbolId: "createCheckout" }
    });
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "failure",
      payload: { filePath: "src/checkout.ts", symbolId: "createCheckout", message: "Gateway timeout" }
    });
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType: "decision",
      payload: { decision: "Investigate retry path first" }
    });

    const session = {
      resume: forge.resume(),
      matchingEvents: forge.session("timeout").length,
      why: forge.why("checkout timeout"),
      prefetch: forge.prefetchSuggestions()
    };

    const impact = ["shouldRetry", "parseSession"].map((query) => ({
      query,
      impacted: forge.impact(query).map((symbol) => symbol.canonicalName).slice(0, 5)
    }));

    const startupState = forge.startup("why is checkout timing out and which files are likely involved?");
    const toolPage = startupState.pages.find((page) => page.sourceItemId === "forge_tools");
    const firstFault = toolPage ? forge.notePageFault(toolPage.pageId, "repeat_fault") : null;
    const secondFault = toolPage ? forge.notePageFault(toolPage.pageId, "repeat_fault") : null;
    const pager = {
      before: forge.pageState(),
      firstFault,
      secondFault,
      after: forge.pageState()
    };

    return {
      rootDir: path.resolve(rootDir),
      indexSummary,
      startup,
      compression,
      retrieval,
      alias,
      raptor,
      impact,
      session,
      pager,
      stats: forge.stats()
    };
  } finally {
    forge.close();
  }
}
