import { clip, tokenize, unique } from "../utils/text.js";
import { listSessionEvents } from "./events.js";

export function searchSessionEvents(db: any, {
  repoId,
  sessionId,
  query = "",
  limit = 5,
  seedFiles = [],
  seedSymbols = [],
  seedHints = []
}: Record<string, any>) {
  const normalizedQuery = String(query ?? "").trim();
  const tokens: string[] = extractFtsTerms(normalizedQuery).slice(0, 8);
  const candidates = new Map();

  if (tokens.length) {
    const matchQuery = tokens.map((token) => `${token}*`).join(" OR ");
    const rows = db.prepare(`
      SELECT
        session_events.event_id AS eventId,
        session_events.repo_id AS repoId,
        session_events.session_id AS sessionId,
        session_events.event_type AS eventType,
        session_events.payload_json AS payloadJson,
        session_events.confidence AS confidence,
        session_events.created_at AS createdAt,
        bm25(session_event_fts) AS rank
      FROM session_event_fts
      JOIN session_events
        ON session_events.event_id = session_event_fts.event_id
      WHERE session_events.repo_id = ?
        AND session_events.session_id = ?
        AND session_event_fts MATCH ?
      ORDER BY rank ASC, session_events.created_at DESC
      LIMIT ?
    `).all(repoId, sessionId, matchQuery, Math.max(limit * 4, 8));

    for (const row of rows) {
      candidates.set(row.eventId, {
        eventId: row.eventId,
        repoId: row.repoId,
        sessionId: row.sessionId,
        eventType: row.eventType,
        payload: JSON.parse(row.payloadJson),
        confidence: row.confidence,
        createdAt: row.createdAt,
        rankScore: Number.isFinite(row.rank) ? 1 / (1 + Math.max(0, row.rank)) : 0
      });
    }
  }

  for (const event of listSessionEvents(db, sessionId, repoId).slice(-Math.max(limit * 3, 8))) {
    if (!candidates.has(event.eventId)) {
      candidates.set(event.eventId, {
        ...event,
        rankScore: 0
      });
    }
  }

  const loweredHints = unique([
    ...seedHints,
    ...seedFiles,
    ...seedSymbols
  ].map((value) => String(value ?? "").toLowerCase()).filter(Boolean)) as string[];
  const loweredFiles = new Set(seedFiles.map((value) => String(value ?? "").toLowerCase()));
  const loweredSymbols = new Set(seedSymbols.map((value) => String(value ?? "").toLowerCase()));

  return [...candidates.values()]
    .map((event) => {
      const payload = event.payload ?? {};
      const payloadText = JSON.stringify(payload).toLowerCase();
      const haystack = `${event.eventType} ${payloadText}`;
      let score = event.rankScore * 8;

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += 1.2;
        }
      }

      for (const hint of loweredHints) {
        if (haystack.includes(hint)) {
          score += 1.8;
        }
      }

      if (payload.filePath && loweredFiles.has(String(payload.filePath).toLowerCase())) {
        score += 5;
      }

      if (payload.symbolId && loweredSymbols.has(String(payload.symbolId).toLowerCase())) {
        score += 5;
      }

      if (event.eventType === "failure") {
        score += 1.5;
      }

      if (event.eventType === "decision") {
        score += 0.8;
      }

      if (event.eventType === "edit_file" || event.eventType === "edit") {
        score += 0.8;
      }

      return {
        eventId: event.eventId,
        eventType: event.eventType,
        createdAt: event.createdAt,
        payload: compactSessionPayload(payload),
        score: Number(score.toFixed(3))
      };
    })
    .filter((event) => event.score > 0 || !normalizedQuery)
    .sort((left, right) => right.score - left.score || right.createdAt - left.createdAt)
    .slice(0, limit);
}

function compactSessionPayload(payload: Record<string, any>) {
  const compact: Record<string, any> = {};
  for (const key of ["filePath", "symbolId", "message", "decision", "note", "query", "toolName"]) {
    if (payload?.[key] != null) {
      compact[key] = payload[key];
    }
  }

  if (!Object.keys(compact).length && payload) {
    const firstKeys = Object.keys(payload).slice(0, 2);
    for (const key of firstKeys) {
      compact[key] = payload[key];
    }
  }

  if (compact.message) {
    compact.message = clip(compact.message, 180);
  }
  if (compact.note) {
    compact.note = clip(compact.note, 180);
  }
  if (compact.decision) {
    compact.decision = clip(compact.decision, 180);
  }

  return compact;
}

function extractFtsTerms(query: string): string[] {
  return unique(tokenize(query)
    .flatMap((token) => token.split(/[^a-z0-9_]+/g))
    .map((token) => token.trim())
    .filter(Boolean)) as string[];
}
