import { makeId } from "../indexing/canonicalize.js";

export function makeSessionEvent({ repoId, sessionId, eventType, payload, confidence = 1 }): any {
  const createdAt = Date.now();
  return {
    eventId: makeId("session", `${sessionId}:${eventType}:${createdAt}:${JSON.stringify(payload)}`),
    repoId,
    sessionId,
    eventType,
    payload,
    confidence,
    createdAt
  };
}

export function buildSessionEdges(events): any[] {
  const edges = [];
  for (let i = 0; i < events.length - 1; i += 1) {
    edges.push({
      edgeId: makeId("session_edge", `${events[i].eventId}:${events[i + 1].eventId}`),
      repoId: events[i].repoId,
      fromEventId: events[i].eventId,
      toEventId: events[i + 1].eventId,
      edgeType: "followed_by",
      confidence: 1
    });
  }
  return edges;
}
