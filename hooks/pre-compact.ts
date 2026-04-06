import { createContextForge } from "../src/contextforge.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "../src/session/runtime.js";

export function preCompact(rootDir: string, options: Record<string, any> = {}) {
  const sessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: options.sessionId,
    preferActive: true
  });
  const forge = createContextForge(rootDir, sessionId ? { sessionId } : {});
  try {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "hook",
      command: "pre-compact"
    });
    return {
      ...forge.resume(),
      sessionId: forge.sessionId
    };
  } finally {
    forge.close();
  }
}
