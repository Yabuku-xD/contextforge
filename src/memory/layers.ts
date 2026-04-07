import { estimateTokens } from "../utils/text.js";
import { CONTEXTFORGE_MEMORY_DIALECT_NAME, CONTEXTFORGE_MEMORY_DIALECT_SPEC, renderForgeCapsule } from "./dialect.js";
import {
  getMemoryProfile,
  getMemoryStats,
  listActiveFacts,
  listRecentMemoryEntries,
  readDiaryEntries,
  searchMemory
} from "./store.js";

export const CONTEXTFORGE_MEMORY_PROTOCOL = [
  "ContextForge Memory Protocol:",
  "1. On session start or repo handoff, load forge_memory_wakeup or forge_memory_status before guessing about prior decisions or personal/project history.",
  "2. Before stating a remembered fact about a person, project, tool choice, or past event, verify it with forge_memory_search or forge_memory_fact_query.",
  "3. When a fact changes, add the new fact and invalidate the old one instead of silently overwriting memory.",
  "4. Save durable insights, decisions, and session checkpoints with forge_memory_save or forge_memory_diary_write so they survive repo/session boundaries.",
  "5. Use wake-up memory for compact always-loaded context, recall for topic-local context, and deep search only when needed."
].join(" ");

export function buildMemoryStatus(db: any, {
  repoId = null,
  repoName = "current-repo",
  sessionId = null
}: Record<string, any> = {}) {
  const identity = getMemoryProfile(db, "identity");
  const project = getMemoryProfile(db, `project:${repoName}`);
  const counts = getMemoryStats(db, repoId);
  const wakeup = buildMemoryWakeup(db, { repoId, repoName, sessionId, includeProtocol: false });

  return {
    repoId,
    repoName,
    sessionId,
    globalMemory: {
      enabled: true,
      dialect: CONTEXTFORGE_MEMORY_DIALECT_NAME,
      protocol: CONTEXTFORGE_MEMORY_PROTOCOL
    },
    counts,
    profiles: {
      identity: identity ? profileSummary(identity) : null,
      project: project ? profileSummary(project) : null
    },
    layers: {
      L0_identity: {
        exists: Boolean(identity),
        tokenEstimate: identity ? estimateTokens(identity.summary) : 0
      },
      L1_essentialStory: {
        tokenEstimate: wakeup.layer1.tokenEstimate,
        entryCount: wakeup.layer1.entryCount,
        factCount: wakeup.layer1.factCount
      },
      L2_recall: {
        description: "Topic or repo-scoped recall from current wings/rooms."
      },
      L3_search: {
        description: "Deep hybrid search across memory entries, diaries, and facts."
      }
    },
    wakeupPreview: wakeup.text,
    dialectSpec: CONTEXTFORGE_MEMORY_DIALECT_SPEC
  };
}

export function buildMemoryWakeup(db: any, {
  repoId = null,
  repoName = "current-repo",
  sessionId = null,
  includeProtocol = true
}: Record<string, any> = {}) {
  const identity = getMemoryProfile(db, "identity");
  const project = getMemoryProfile(db, `project:${repoName}`);
  const essentialEntries = listRecentMemoryEntries(db, { repoId, wing: repoName, limit: 6 });
  const recentEntries = essentialEntries.length
    ? essentialEntries
    : listRecentMemoryEntries(db, { repoId, limit: 6 });
  const activeFacts = listActiveFacts(db, repoId, 6);
  const diaries = readDiaryEntries(db, { repoId, sessionId, limit: 3 });

  const layer0Text = buildLayer0(identity, project, repoName);
  const layer1Text = buildLayer1(recentEntries, activeFacts, diaries);
  const text = [
    includeProtocol ? `## Memory Protocol\n${CONTEXTFORGE_MEMORY_PROTOCOL}` : null,
    layer0Text,
    layer1Text
  ].filter(Boolean).join("\n\n");

  return {
    layer0: {
      text: layer0Text,
      tokenEstimate: estimateTokens(layer0Text)
    },
    layer1: {
      text: layer1Text,
      tokenEstimate: estimateTokens(layer1Text),
      entryCount: recentEntries.length,
      factCount: activeFacts.length,
      diaryCount: diaries.length
    },
    protocol: includeProtocol ? CONTEXTFORGE_MEMORY_PROTOCOL : null,
    dialect: CONTEXTFORGE_MEMORY_DIALECT_NAME,
    text,
    tokenEstimate: estimateTokens(text)
  };
}

export function buildMemoryRecall(db: any, {
  query = "",
  repoId = null,
  repoName = "current-repo",
  wing = null,
  hall = null,
  room = null,
  limit = 6
}: Record<string, any> = {}) {
  const normalizedWing = wing ?? repoName;
  if (String(query ?? "").trim()) {
    return {
      layer: "L2",
      mode: "query",
      ...searchMemory(db, { query, repoId, wing: normalizedWing, hall, room, limit, includeDiaries: true })
    };
  }

  const entries = listRecentMemoryEntries(db, { repoId, wing: normalizedWing, hall, room, limit });
  return {
    layer: "L2",
    mode: "scoped_recent",
    wing: normalizedWing,
    hall,
    room,
    results: entries.map((entry: any) => ({
      kind: "entry",
      entryId: entry.entryId,
      wing: entry.wing,
      hall: entry.hall,
      room: entry.room,
      title: entry.title,
      preview: entry.summary,
      tags: entry.tags,
      entities: entry.entities
    })),
    summary: `Loaded ${entries.length} scoped memory entr${entries.length === 1 ? "y" : "ies"} from ${normalizedWing}.`
  };
}

function buildLayer0(identity: any, project: any, repoName: string) {
  const lines = ["## L0 — IDENTITY"];
  if (identity) {
    lines.push(identity.aaak || renderForgeCapsule({
      wing: "identity",
      hall: "facts",
      room: "assistant",
      title: identity.name,
      summary: identity.summary,
      importance: 0.8
    }));
  } else {
    lines.push("No identity configured yet. Use forge_memory_profile_set to define the assistant's long-term identity.");
  }

  if (project) {
    lines.push("");
    lines.push("## L0b — PROJECT");
    lines.push(project.aaak || renderForgeCapsule({
      wing: repoName,
      hall: "facts",
      room: "project",
      title: project.name,
      summary: project.summary,
      importance: 0.7
    }));
  }

  return lines.join("\n");
}

function buildLayer1(entries: any[], facts: any[], diaries: any[]) {
  const lines = ["## L1 — ESSENTIAL STORY"];

  if (!entries.length && !facts.length && !diaries.length) {
    lines.push("No durable memory yet. Save important decisions, discoveries, or diary notes to build the wake-up layer.");
    return lines.join("\n");
  }

  if (entries.length) {
    lines.push("[entries]");
    for (const entry of entries.slice(0, 6)) {
      lines.push(`- ${entry.aaak || renderForgeCapsule({
        wing: entry.wing,
        hall: entry.hall,
        room: entry.room,
        title: entry.title,
        summary: entry.summary,
        tags: entry.tags,
        importance: entry.importance,
        entities: entry.entities
      })}`);
    }
  }

  if (facts.length) {
    lines.push("[facts]");
    for (const fact of facts.slice(0, 5)) {
      lines.push(`- ${fact.subject} ${fact.predicate} ${fact.object}${fact.validFrom ? ` (from ${fact.validFrom})` : ""}`);
    }
  }

  if (diaries.length) {
    lines.push("[diary]");
    for (const diary of diaries.slice(0, 3)) {
      lines.push(`- ${diary.aaak || renderForgeCapsule({
        wing: "diary",
        hall: "diary",
        room: diary.agentId,
        title: diary.title,
        summary: diary.entryText,
        tags: diary.tags,
        importance: 0.45
      })}`);
    }
  }

  return lines.join("\n");
}

function profileSummary(profile: any) {
  return {
    profileType: profile.profileType,
    name: profile.name,
    summary: profile.summary,
    aaak: profile.aaak,
    updatedAt: profile.updatedAt
  };
}
