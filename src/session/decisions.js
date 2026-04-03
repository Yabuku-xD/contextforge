import { recordSessionEvent } from "./events.js";

export function recordDecision(db, { repoId, sessionId, decision, scope = "general" }) {
  return recordSessionEvent(db, {
    repoId,
    sessionId,
    eventType: "decision",
    payload: { decision, scope }
  });
}
