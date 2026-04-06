import { COMPRESSION_PRESETS } from "./presets.js";
import { compressWithLLMLingua2 } from "./llmlingua2.js";
import { runFidelityChecks } from "./fidelity-checks.js";

export async function safeCompress(content: string, { contentType, preferModel = false }: Record<string, any> = {}) {
  const text = String(content ?? "");
  const preset = COMPRESSION_PRESETS[contentType] ?? COMPRESSION_PRESETS.plain_text;
  const targetToken = Math.max(64, Math.floor(estimateTokens(text) * preset.ratio));

  let compressed = preferModel ? await compressWithLLMLingua2(text, { targetToken }) : null;
  if (!compressed) {
    compressed = heuristicCompress(text, preset.sentenceLimit, contentType);
  }

  const fidelity = runFidelityChecks({ contentType, original: text, compressed });
  return {
    compressed: fidelity.ok ? compressed : text,
    usedFallback: !preferModel || !compressed,
    fidelity,
    rawSize: text.length,
    compressedSize: (fidelity.ok ? compressed : text).length
  };
}

export function heuristicCompress(text, sentenceLimit = 18, contentType = "plain_text") {
  if (contentType === "log") {
    return compressLog(text, sentenceLimit);
  }

  if (contentType === "dom_snapshot") {
    return compressDomSnapshot(text, sentenceLimit);
  }

  if (contentType === "prose_doc" || contentType === "plain_text") {
    return compressProse(text, sentenceLimit);
  }

  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const deduped = [];
  const seen = new Set();

  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(line);
    if (deduped.length >= sentenceLimit) {
      break;
    }
  }

  return deduped.join("\n");
}

function compressLog(text, sentenceLimit) {
  const counts = new Map();
  const ordered = [];
  for (const line of String(text ?? "").split("\n").map((value) => value.trim()).filter(Boolean)) {
    const key = line.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered.slice(0, sentenceLimit).map((key) => {
    const count = counts.get(key) ?? 1;
    const original = String(text ?? "").split("\n").find((line) => line.trim().toLowerCase() === key)?.trim() ?? key;
    return count > 1 ? `[x${count}] ${original}` : original;
  }).join("\n");
}

function compressDomSnapshot(text, sentenceLimit) {
  const important = String(text ?? "")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /(data-testid|aria-|role=|id=|class=|name=|type=|timeout|error|button|input)/i.test(line));

  return [...new Set(important)].slice(0, sentenceLimit).join("\n");
}

function compressProse(text, sentenceLimit) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  return lines
    .map((line, index) => ({
      line,
      score: proseScore(line, index, lines.length)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, sentenceLimit)
    .sort((left, right) => lines.indexOf(left.line) - lines.indexOf(right.line))
    .map((entry) => entry.line)
    .join("\n");
}

function proseScore(line, index, totalLines) {
  let score = 0;
  if (/^#{1,6}\s/.test(line)) score += 4;
  if (index === 0 || index === totalLines - 1) score += 2;
  if (/\b(error|warning|timeout|failing|impact|decision|result)\b/i.test(line)) score += 2;
  if (line.length < 120) score += 0.5;
  return score;
}

function estimateTokens(value) {
  return Math.ceil(String(value ?? "").length / 4);
}
