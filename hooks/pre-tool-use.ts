import { createContextForge } from "../src/contextforge.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "../src/session/runtime.js";

export async function preToolUse(rootDir: string, content: string, metadata: Record<string, any> = {}) {
  const sessionId = resolveRuntimeSessionId(rootDir, {
    sessionId: metadata.sessionId,
    preferActive: true
  });
  const forge = createContextForge(rootDir, sessionId ? { sessionId } : {});
  try {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "hook",
      command: "pre-tool-use"
    });
    return {
      ...(await forge.processArtifact(content, metadata)),
      sessionId: forge.sessionId
    };
  } finally {
    forge.close();
  }
}
