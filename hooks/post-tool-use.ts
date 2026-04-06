import { createContextForge } from "../src/contextforge.js";
import { recordSessionEvent } from "../src/session/events.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "../src/session/runtime.js";

export function postToolUse(rootDir: string, eventType: string, payload: Record<string, any> = {}, options: Record<string, any> = {}) {
  const sessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: options.sessionId,
    preferActive: true
  });
  const forge = createContextForge(rootDir, sessionId ? { sessionId } : {});
  try {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "hook",
      command: "post-tool-use"
    });
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType,
      payload
    });
    return forge.prefetchSuggestions();
  } finally {
    forge.close();
  }
}
