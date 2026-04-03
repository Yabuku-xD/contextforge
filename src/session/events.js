import { makeSessionEvent, buildSessionEdges } from "../graph/session-graph.js";
import { redactSecrets } from "./redaction.js";

export function recordSessionEvent(db, { repoId, sessionId, eventType, payload, confidence = 1 }) {
  const safePayload = JSON.parse(JSON.stringify(payload ?? {}));
  for (const key of Object.keys(safePayload)) {
    if (typeof safePayload[key] === "string") {
      safePayload[key] = redactSecrets(safePayload[key]);
    }
  }

  const event = makeSessionEvent({ repoId, sessionId, eventType, payload: safePayload, confidence });
  db.prepare(`
    INSERT OR REPLACE INTO session_events (event_id, repo_id, session_id, event_type, payload_json, confidence, created_at)
    VALUES (@eventId, @repoId, @sessionId, @eventType, @payloadJson, @confidence, @createdAt)
  `).run({
    ...event,
    payloadJson: JSON.stringify(event.payload)
  });

  const events = listSessionEvents(db, sessionId, repoId);
  const edges = buildSessionEdges(events);
  const insertEdge = db.prepare(`
    INSERT OR REPLACE INTO session_edges (edge_id, repo_id, from_event_id, to_event_id, edge_type, confidence)
    VALUES (@edgeId, @repoId, @fromEventId, @toEventId, @edgeType, @confidence)
  `);
  for (const edge of edges) {
    insertEdge.run(edge);
  }

  return event;
}

export function listSessionEvents(db, sessionId, repoId) {
  return db.prepare(`
    SELECT event_id AS eventId, repo_id AS repoId, session_id AS sessionId, event_type AS eventType,
           payload_json AS payloadJson, confidence, created_at AS createdAt
    FROM session_events
    WHERE session_id = ? AND repo_id = ?
    ORDER BY created_at ASC
  `).all(sessionId, repoId).map((row) => ({
    ...row,
    payload: JSON.parse(row.payloadJson)
  }));
}
