import { clip } from "../utils/text.js";
import { listSessionEvents } from "./events.js";

const DEFAULT_EXCLUDED_EVENT_TYPES = new Set(["index", "index_reuse", "startup"]);

export function buildResumeSummary(
  db: any,
  { repoId, sessionId, maxEvents = 10, excludeEventTypes = DEFAULT_EXCLUDED_EVENT_TYPES }: Record<string, any> = {}
) {
  const events = listSessionEvents(db, sessionId, repoId)
    .filter((event) => !excludeEventTypes.has(event.eventType))
    .slice(-maxEvents);
  const lines = events.map((event) => `- ${event.eventType}: ${clip(JSON.stringify(event.payload), 120)}`);
  return {
    sessionId,
    count: events.length,
    summary: lines.join("\n")
  };
}
