import path from "node:path";

import { clip, tokenize, unique } from "../utils/text.js";
import { renderForgeCapsule } from "./dialect.js";
import { slugify } from "./store.js";

const IGNORED_EVENT_TYPES = new Set([
  "index",
  "index_reuse",
  "startup",
  "search",
  "memory_save",
  "memory_diary_write",
  "memory_fact_add",
  "memory_fact_invalidate"
]);
const AUTOSAVE_EVENT_THRESHOLD = 8;

export function buildSessionCheckpointCandidate(events: any[], {
  repoId = null,
  repoName = "repo",
  sessionId = null,
  lastCheckpointAt = 0,
  force = false
}: Record<string, any> = {}) {
  const relevant = events
    .filter((event) => !IGNORED_EVENT_TYPES.has(event.eventType))
    .filter((event) => Number(event.createdAt ?? 0) > Number(lastCheckpointAt ?? 0));

  if (!force && relevant.length < AUTOSAVE_EVENT_THRESHOLD) {
    return null;
  }

  if (!relevant.length) {
    return null;
  }

  const tags = collectTags(relevant);
  const focus = collectFocus(relevant);
  const title = `${repoName} checkpoint ${new Date(relevant[relevant.length - 1].createdAt).toISOString().slice(0, 16).replace("T", " ")}`;
  const hall = inferHall(relevant);
  const room = slugify(focus.primaryRoom ?? tags[0] ?? repoName, "general");
  const summary = buildSummary(relevant, tags, focus);
  const detail = relevant.map((event) => `- ${formatEventLine(event)}`).join("\n");
  const entities = unique([
    repoName,
    ...focus.entities,
    ...tags.filter((tag) => !tag.includes("/")).slice(0, 5)
  ]);
  const importance = Math.min(1, 0.35 + (relevant.length / 16));
  const aaak = renderForgeCapsule({
    wing: repoName,
    hall,
    room,
    title,
    summary,
    tags,
    importance,
    entities,
    source: sessionId ? `session.${sessionId}` : "session"
  });

  return {
    scope: "repo",
    repoId,
    sessionId,
    wing: repoName,
    hall,
    room,
    title,
    summary,
    detail,
    aaak,
    tags,
    entities,
    importance,
    sourceType: "session_autosave",
    sourceRef: relevant[relevant.length - 1].eventId,
    eventCount: relevant.length,
    lastEventId: relevant[relevant.length - 1].eventId,
    lastEventAt: relevant[relevant.length - 1].createdAt
  };
}

export function buildDiaryFromCheckpoint(checkpoint: Record<string, any>, agentId = "claude") {
  return {
    agentId,
    repoId: checkpoint.repoId ?? null,
    sessionId: checkpoint.sessionId ?? null,
    title: checkpoint.title,
    entryText: `${checkpoint.summary}\n\n${checkpoint.detail}`,
    aaak: checkpoint.aaak,
    tags: checkpoint.tags
  };
}

function buildSummary(events: any[], tags: string[], focus: Record<string, any>) {
  const typeCounts = new Map<string, number>();
  for (const event of events) {
    typeCounts.set(event.eventType, (typeCounts.get(event.eventType) ?? 0) + 1);
  }
  const eventSummary = [...typeCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([eventType, count]) => `${eventType} x${count}`)
    .join(", ");
  const focusParts = [
    focus.primaryFile ? `focused on ${focus.primaryFile}` : "",
    focus.primarySymbol ? `symbol ${focus.primarySymbol}` : "",
    focus.primaryQuery ? `query ${focus.primaryQuery}` : ""
  ].filter(Boolean);
  const tagSummary = tags.slice(0, 4).join(", ");
  return clip(`Captured ${events.length} session events (${eventSummary})${focusParts.length ? `; ${focusParts.join(", ")}` : ""}${tagSummary ? ` around ${tagSummary}` : ""}.`, 220);
}

function inferHall(events: any[]) {
  const text = events.map((event) => `${event.eventType} ${JSON.stringify(event.payload ?? {})}`).join(" ").toLowerCase();
  if (/\b(impact|root cause|why|discover|learned|fix)\b/.test(text)) {
    return "discoveries";
  }
  if (/\b(rename|decision|fact|agreed|locked|config)\b/.test(text)) {
    return "facts";
  }
  if (/\b(prefer|setting|style|format)\b/.test(text)) {
    return "preferences";
  }
  if (/\b(advice|recommend|should)\b/.test(text)) {
    return "advice";
  }
  return "events";
}

function collectFocus(events: any[]) {
  const fileCounts = new Map<string, number>();
  const symbolCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();

  for (const event of events) {
    const payload = event.payload ?? {};
    for (const candidate of [payload.filePath, payload.topFilePath]) {
      if (candidate) {
        fileCounts.set(String(candidate), (fileCounts.get(String(candidate)) ?? 0) + 1);
      }
    }
    if (payload.symbolId) {
      const symbol = String(payload.symbolId).split(":").pop() ?? String(payload.symbolId);
      symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
    }
    if (payload.query) {
      const query = clip(String(payload.query).replace(/\s+/g, " ").trim(), 60);
      queryCounts.set(query, (queryCounts.get(query) ?? 0) + 1);
    }
  }

  const primaryFile = topCount(fileCounts);
  const primarySymbol = topCount(symbolCounts);
  const primaryQuery = topCount(queryCounts);
  return {
    primaryFile,
    primarySymbol,
    primaryQuery,
    primaryRoom: primarySymbol ?? (primaryFile ? path.basename(primaryFile, path.extname(primaryFile)) : null),
    entities: unique([primarySymbol, primaryFile ? path.basename(primaryFile) : null, primaryFile].filter(Boolean))
  };
}

function collectTags(events: any[]) {
  const tags: string[] = [];
  for (const event of events) {
    const payload = event.payload ?? {};
    if (payload.filePath) {
      tags.push(String(payload.filePath));
      tags.push(path.basename(String(payload.filePath), path.extname(String(payload.filePath))));
    }
    if (payload.symbolId) {
      tags.push(String(payload.symbolId).split(":").pop() ?? String(payload.symbolId));
    }
    if (payload.query) {
      tags.push(...tokenize(String(payload.query)).filter((token) => token.length > 2));
    }
    if (payload.command) {
      tags.push(...String(payload.command).split(/\s+/).slice(0, 3));
    }
    tags.push(event.eventType);
  }
  return unique(tags.map((tag) => String(tag).trim()).filter(Boolean)).slice(0, 12);
}

function topCount(map: Map<string, number>) {
  return [...map.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function formatEventLine(event: any) {
  const payload = event.payload ?? {};
  const parts = [event.eventType];
  if (payload.filePath) {
    parts.push(`file=${payload.filePath}`);
  }
  if (payload.query) {
    parts.push(`query=${clip(payload.query, 80)}`);
  }
  if (payload.command) {
    parts.push(`command=${clip(payload.command, 80)}`);
  }
  if (payload.topFilePath) {
    parts.push(`top=${payload.topFilePath}`);
  }
  if (payload.taskLabel) {
    parts.push(`task=${payload.taskLabel}`);
  }
  if (payload.exitCode != null) {
    parts.push(`exit=${payload.exitCode}`);
  }
  if (payload.replacements != null) {
    parts.push(`replacements=${payload.replacements}`);
  }
  if (payload.resultCount != null) {
    parts.push(`results=${payload.resultCount}`);
  }
  return parts.join(" | ");
}
