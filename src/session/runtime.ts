import fs from "node:fs";
import path from "node:path";

import { ensureDir, exists, readText, writeText } from "../utils/fs.js";

const ACTIVE_SESSION_FILE = "active-session.json";
const ENV_SESSION_KEYS = ["CONTEXTFORGE_SESSION_ID", "CLAUDE_SESSION_ID", "SESSION_ID"];

export function resolveRuntimeSessionId(rootDir, { sessionId, preferActive = false, env = process.env } = {}) {
  if (sessionId) {
    return String(sessionId);
  }

  for (const key of ENV_SESSION_KEYS) {
    if (env?.[key]) {
      return String(env[key]);
    }
  }

  if (preferActive) {
    return readActiveSession(rootDir)?.sessionId ?? null;
  }

  return null;
}

export function rememberActiveSession(rootDir, sessionId, metadata = {}) {
  if (!sessionId) {
    return null;
  }

  const filePath = activeSessionFile(rootDir);
  const payload = {
    sessionId: String(sessionId),
    updatedAt: Date.now(),
    ...metadata
  };
  ensureDir(path.dirname(filePath));
  writeText(filePath, JSON.stringify(payload, null, 2));
  return payload;
}

export function readActiveSession(rootDir) {
  const filePath = activeSessionFile(rootDir);
  if (!exists(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readText(filePath));
    if (!parsed?.sessionId) {
      return null;
    }

    return {
      sessionId: String(parsed.sessionId),
      updatedAt: parsed.updatedAt ?? null,
      source: parsed.source ?? null,
      command: parsed.command ?? null
    };
  } catch {
    return null;
  }
}

export function clearActiveSession(rootDir, sessionId = null) {
  const current = readActiveSession(rootDir);
  if (!current) {
    return {
      cleared: false,
      activeSession: null
    };
  }

  if (sessionId && current.sessionId !== sessionId) {
    return {
      cleared: false,
      activeSession: current
    };
  }

  const filePath = activeSessionFile(rootDir);
  fs.rmSync(filePath, { force: true });
  return {
    cleared: true,
    activeSession: current
  };
}

function activeSessionFile(rootDir) {
  return path.join(path.resolve(rootDir), ".contextforge", ACTIVE_SESSION_FILE);
}
