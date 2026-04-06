import { createContextForge } from "../contextforge.js";
import { recordSessionEvent } from "../session/events.js";
import { rememberActiveSession, resolveRuntimeSessionId } from "../session/runtime.js";

type HookForgeCallback<T> = (forge: any) => Promise<T> | T;

function withHookForge<T>(
  rootDir: string,
  sessionId: string | null | undefined,
  command: string,
  preferActive: boolean,
  callback: HookForgeCallback<T>
): T | Promise<T> {
  const resolvedSessionId = resolveRuntimeSessionId(rootDir, {
    sessionId,
    preferActive
  });
  const forge = createContextForge(rootDir, resolvedSessionId ? { sessionId: resolvedSessionId } : {});
  try {
    rememberActiveSession(rootDir, forge.sessionId, {
      source: "hook",
      command
    });
    const result = callback(forge);
    if (result && typeof (result as Promise<T>).then === "function") {
      return (result as Promise<T>).finally(() => {
        forge.close();
      });
    }
    forge.close();
    return result;
  } catch (error) {
    if (!forge._closed) {
      forge.close();
    }
    throw error;
  }
}

export function runSessionStart(rootDir: string, message: string, options: Record<string, any> = {}) {
  return withHookForge(rootDir, options.sessionId, "session-start", false, (forge) => ({
    ...forge.startup(message),
    sessionId: forge.sessionId
  }));
}

export async function runPreToolUse(rootDir: string, content: string, metadata: Record<string, any> = {}) {
  return withHookForge(rootDir, metadata.sessionId, "pre-tool-use", true, async (forge) => ({
    ...(await forge.processArtifact(content, metadata)),
    sessionId: forge.sessionId
  }));
}

export function runPostToolUse(
  rootDir: string,
  eventType: string,
  payload: Record<string, any> = {},
  options: Record<string, any> = {}
) {
  return withHookForge(rootDir, options.sessionId, "post-tool-use", true, (forge) => {
    recordSessionEvent(forge.db, {
      repoId: forge.repoId,
      sessionId: forge.sessionId,
      eventType,
      payload
    });
    return forge.prefetchSuggestions();
  });
}

export function runPreCompact(rootDir: string, options: Record<string, any> = {}) {
  return withHookForge(rootDir, options.sessionId, "pre-compact", true, (forge) => ({
    ...forge.resume(),
    sessionId: forge.sessionId
  }));
}
