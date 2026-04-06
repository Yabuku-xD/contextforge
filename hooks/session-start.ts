import { createContextForge } from "../src/contextforge.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "../src/session/runtime.js";

export function sessionStart(rootDir: string, message: string, options: Record<string, any> = {}) {
  const sessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: options.sessionId,
    preferActive: false
  });
  const forge = createContextForge(rootDir, sessionId ? { sessionId } : {});
  try {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "hook",
      command: "session-start"
    });
    return {
      ...forge.startup(message),
      sessionId: forge.sessionId
    };
  } finally {
    forge.close();
  }
}
