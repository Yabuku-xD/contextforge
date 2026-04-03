import path from "node:path";

import { runOpenTrack } from "./open-track.js";
import { runClosedTrack, runSweBenchSubset } from "./phase3.js";
import { runReleaseStatus } from "./release.js";

export async function runScoreboard(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const [openTrack, swebench, closedTrack, release] = await Promise.all([
    runOpenTrack(resolvedRoot),
    runSweBenchSubset(resolvedRoot),
    runClosedTrack(resolvedRoot),
    runReleaseStatus(resolvedRoot)
  ]);

  const openTrackRows = openTrack.baselines.map((baseline) => ({
    name: baseline.name,
    available: baseline.available,
    source: baseline.source,
    startupTokens: baseline.summary?.startup?.avgTokensBeforeUsefulAction ?? null,
    compressionReduction: baseline.summary?.compression?.avgTokenReduction ?? null,
    compressionFidelity: baseline.summary?.compression?.fidelityRate ?? null,
    retrievalHitAt1: baseline.summary?.retrieval?.hitAt1 ?? null,
    retrievalTokens: baseline.summary?.retrieval?.avgTokensToCorrectAnswer ?? null,
    sessionRecall: baseline.summary?.session?.recallAtK ?? null,
    endToEndSuccess: baseline.summary?.endToEnd?.successRate ?? null,
    endToEndTokens: baseline.summary?.endToEnd?.tokensPerSuccessfulTask ?? null
  }));

  const swebenchRows = swebench.baselines.map((baseline) => ({
    name: baseline.name,
    available: baseline.available,
    source: baseline.source,
    successRate: baseline.summary?.swebenchSubset?.successRate ?? null,
    tokensPerSuccessfulTask: baseline.summary?.swebenchSubset?.tokensPerSuccessfulTask ?? null,
    filesReadPerSuccessfulTask: baseline.summary?.swebenchSubset?.filesReadPerSuccessfulTask ?? null,
    avgLatencyMs: baseline.summary?.swebenchSubset?.avgLatencyMs ?? null
  }));

  const closedRows = closedTrack.baselines.map((baseline) => ({
    name: baseline.name,
    available: baseline.available,
    source: baseline.source,
    localVerifiedSuccess: baseline.summary?.localVerified?.successRate ?? null,
    localVerifiedTokens: baseline.summary?.localVerified?.tokensPerSuccessfulTask ?? null,
    swebenchSuccess: baseline.summary?.swebenchSubset?.successRate ?? null,
    swebenchTokens: baseline.summary?.swebenchSubset?.tokensPerSuccessfulTask ?? null
  }));

  return {
    rootDir: resolvedRoot,
    generatedAt: new Date().toISOString(),
    release: {
      overallStatus: release.overallStatus,
      coreProduct: release.coreProduct,
      benchmarkEvidence: release.benchmarkEvidence
    },
    openTrack: {
      status: openTrack.releaseGates.overallStatus,
      winners: openTrack.summary.winners,
      rows: openTrackRows
    },
    swebenchSubset: {
      status: swebench.gates.overallStatus,
      winner: swebench.summary.winner,
      rows: swebenchRows
    },
    closedTrack: {
      status: closedTrack.releaseGates.overallStatus,
      winners: closedTrack.summary.winners,
      rows: closedRows
    }
  };
}
