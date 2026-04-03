import path from "node:path";

import { exists, readText } from "./utils/fs.js";

const BENCH_ROOT = new URL("../benchmark/", import.meta.url);

const OPEN_TRACK_SPECS = {
  context_mode: {
    track: "open-track",
    source: "external_import",
    summary: {
      startup: ["avgTokensBeforeUsefulAction", "avgLatencyMs", "avgFilesRead"],
      compression: ["fidelityRate", "avgTokenReduction", "avgLatencyMs"],
      retrieval: ["hitAt1", "hitAt5", "mrr", "avgTokensToCorrectAnswer", "avgFilesRead", "avgLatencyMs"],
      session: ["recallAtK", "correctnessRate", "falseCausalLinkRate", "avgLatencyMs"],
      endToEnd: ["successRate", "tokensPerSuccessfulTask", "startupCost", "steadyStateCost", "filesReadPerSuccessfulTask", "avgLatencyMs"]
    }
  },
  token_savior: {
    track: "open-track",
    source: "external_import",
    summary: {
      startup: ["avgTokensBeforeUsefulAction", "avgLatencyMs", "avgFilesRead"],
      compression: ["fidelityRate", "avgTokenReduction", "avgLatencyMs"],
      retrieval: ["hitAt1", "hitAt5", "mrr", "avgTokensToCorrectAnswer", "avgFilesRead", "avgLatencyMs"],
      session: ["recallAtK", "correctnessRate", "falseCausalLinkRate", "avgLatencyMs"],
      endToEnd: ["successRate", "tokensPerSuccessfulTask", "startupCost", "steadyStateCost", "filesReadPerSuccessfulTask", "avgLatencyMs"]
    }
  }
};

const CLOSED_TRACK_SPECS = {};

const REPORT_SPECS = {
  ...OPEN_TRACK_SPECS,
  ...CLOSED_TRACK_SPECS
};

export function loadOpenTrackReport(name) {
  return loadReportFromBench(name, OPEN_TRACK_SPECS[name]);
}

export function loadClosedTrackReport(name) {
  return loadReportFromBench(name, CLOSED_TRACK_SPECS[name]);
}

export function validateReportFile(filePath) {
  const resolved = path.resolve(filePath);
  const name = baselineNameFromPath(resolved);
  const spec = REPORT_SPECS[name];

  if (!spec) {
    throw new Error(`Unsupported report file: ${resolved}`);
  }

  const parsed = JSON.parse(readText(resolved));
  return validateReportObject(parsed, name, spec, resolved);
}

export function reportInventory() {
  return {
    openTrack: inventoryFor(OPEN_TRACK_SPECS),
    closedTrack: inventoryFor(CLOSED_TRACK_SPECS)
  };
}

function inventoryFor(specs) {
  return Object.entries(specs).map(([name, spec]) => {
    const filePath = reportPath(name, spec.track);
    const present = exists(filePath);

    if (!present) {
      return {
        name,
        track: spec.track,
        present: false,
        valid: false,
        filePath
      };
    }

    try {
      const report = validateReportFile(filePath);
      return {
        name,
        track: spec.track,
        present: true,
        valid: true,
        filePath,
        source: report.source
      };
    } catch (error) {
      return {
        name,
        track: spec.track,
        present: true,
        valid: false,
        filePath,
        error: error.message
      };
    }
  });
}

function loadReportFromBench(name, spec) {
  if (!spec) {
    return null;
  }

  const filePath = reportPath(name, spec.track);
  if (!exists(filePath)) {
    return null;
  }

  const parsed = JSON.parse(readText(filePath));
  return validateReportObject(parsed, name, spec, filePath);
}

function reportPath(name, track) {
  return path.resolve(new URL(`${track}/${name}.report.json`, BENCH_ROOT).pathname);
}

function baselineNameFromPath(filePath) {
  return path.basename(filePath).replace(/\.report\.json$/u, "");
}

function validateReportObject(report, expectedName, spec, sourcePath) {
  const object = asObject(report, sourcePath);
  const name = String(object.name ?? expectedName);

  if (name !== expectedName) {
    throw new Error(`${sourcePath} declares "${name}" but expected "${expectedName}"`);
  }

  const summary = validateSummary(object.summary, spec.summary, sourcePath);

  return {
    name,
    available: object.available !== false,
    source: typeof object.source === "string" ? object.source : spec.source,
    summary,
    notes: Array.isArray(object.notes) ? object.notes.map((note) => String(note)) : []
  };
}

function validateSummary(summary, suites, sourcePath) {
  const object = asObject(summary, `${sourcePath}#summary`);
  return Object.fromEntries(
    Object.entries(suites).map(([suiteName, keys]) => {
      const suite = asObject(object[suiteName], `${sourcePath}#summary.${suiteName}`);
      return [
        suiteName,
        Object.fromEntries(keys.map((key) => [key, numericOrNull(suite[key], `${sourcePath}#summary.${suiteName}.${key}`)]))
      ];
    })
  );
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  return value;
}

function numericOrNull(value, label) {
  if (value == null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number or null`);
  }

  return value;
}
