import path from "node:path";

import { createContextForge } from "./contextforge.js";
import { runPhase3 } from "./phase3.js";
import { reportInventory } from "./reports.js";
import { readActiveSession } from "./session/runtime.js";

export async function runReleaseStatus(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  const forge = createContextForge(resolvedRoot, { sessionId: "release_status" });

  let doctor;
  try {
    forge.indexRepository();
    doctor = forge.doctor();
  } finally {
    forge.close();
  }

  const phase3 = await runPhase3(resolvedRoot);
  const reports = reportInventory();

  const coreGates = {
    startup: phase3.openTrack.releaseGates.gates.startup.status,
    compression: phase3.openTrack.releaseGates.gates.compression.status,
    retrieval: phase3.openTrack.releaseGates.gates.retrieval.status,
    endToEnd: phase3.openTrack.releaseGates.gates.endToEnd.status,
    swebenchSubset: phase3.swebench.gates.overallStatus,
    localVerified: phase3.closedTrack.releaseGates.gates.localVerified.status,
    closedTrackSwebench: phase3.closedTrack.releaseGates.gates.swebenchSubset.status
  };

  const coreReady = Object.values(coreGates).every((status) => status === "pass");
  const missingExternalReports = [
    ...phase3.openTrack.releaseGates.missingBaselines,
    ...phase3.closedTrack.releaseGates.missingBaselines
  ];

  return {
    rootDir: resolvedRoot,
    generatedAt: new Date().toISOString(),
    overallStatus: coreReady
      ? (missingExternalReports.length ? "ready_pending_external_reports" : "ready")
      : "needs_work",
    coreProduct: {
      status: coreReady ? "ready" : "needs_work",
      gates: coreGates
    },
    benchmarkEvidence: {
      status: missingExternalReports.length ? "pending_external_reports" : phase3.phaseStatus.overallStatus,
      missingExternalReports
    },
    activeSession: readActiveSession(resolvedRoot),
    doctor,
    reports,
    phase3: {
      phaseStatus: phase3.phaseStatus,
      openTrack: phase3.openTrack.releaseGates,
      swebench: phase3.swebench.gates,
      closedTrack: phase3.closedTrack.releaseGates
    }
  };
}
