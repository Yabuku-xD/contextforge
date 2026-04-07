import { makeId } from "../indexing/canonicalize.js";
import { clip, normalizeIdentifier, tokenize, unique } from "../utils/text.js";
import { redactSecrets, redactSecretsDeep } from "../session/redaction.js";

export const MEMORY_HALLS = ["facts", "events", "discoveries", "preferences", "advice", "diary"];

export function slugify(value: any, fallback = "general") {
  const normalized = normalizeIdentifier(String(value ?? ""))
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "-");
  return normalized || fallback;
}

export function ensureMemoryProfile(db: any, {
  profileType = "identity",
  name = "ContextForge",
  summary,
  aaak = null,
  metadata = {}
}: Record<string, any>) {
  const profileId = makeId("memory_profile", profileType);
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO memory_profiles (
      profile_id, profile_type, name, summary, aaak, metadata_json, created_at, updated_at
    ) VALUES (
      @profileId, @profileType, @name, @summary, @aaak, @metadataJson,
      COALESCE((SELECT created_at FROM memory_profiles WHERE profile_id = @profileId), @now),
      @now
    )
  `).run({
    profileId,
    profileType,
    name: redactSecrets(String(name ?? "ContextForge")),
    summary: redactSecrets(String(summary ?? "")),
    aaak: aaak == null ? null : redactSecrets(String(aaak)),
    metadataJson: JSON.stringify(redactSecretsDeep(metadata ?? {})),
    now
  });

  return getMemoryProfile(db, profileType);
}

export function getMemoryProfile(db: any, profileType = "identity") {
  const row = db.prepare(`
    SELECT profile_id AS profileId, profile_type AS profileType, name, summary, aaak, metadata_json AS metadataJson,
           created_at AS createdAt, updated_at AS updatedAt
    FROM memory_profiles
    WHERE profile_type = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(String(profileType));
  if (!row) {
    return null;
  }
  return {
    ...row,
    metadata: safeJson(row.metadataJson, {})
  };
}

export function listMemoryProfiles(db: any) {
  return db.prepare(`
    SELECT profile_id AS profileId, profile_type AS profileType, name, summary, aaak, metadata_json AS metadataJson,
           created_at AS createdAt, updated_at AS updatedAt
    FROM memory_profiles
    ORDER BY updated_at DESC
  `).all().map((row: any) => ({
    ...row,
    metadata: safeJson(row.metadataJson, {})
  }));
}

export function ensureMemoryEntity(db: any, {
  name,
  entityType = "unknown",
  aliases = [],
  properties = {}
}: Record<string, any>) {
  const displayName = String(name ?? "").trim();
  if (!displayName) {
    throw new Error("Memory entity name must be non-empty.");
  }
  const safeDisplayName = redactSecrets(displayName);
  const canonicalName = slugify(safeDisplayName, "entity");
  const existing = db.prepare(`
    SELECT entity_id AS entityId, canonical_name AS canonicalName, display_name AS displayName,
           entity_type AS entityType, aliases_json AS aliasesJson, properties_json AS propertiesJson
    FROM memory_entities
    WHERE canonical_name = ?
    LIMIT 1
  `).get(canonicalName);
  const entityId = existing?.entityId ?? makeId("memory_entity", canonicalName);
  const mergedAliases = unique([
    ...(safeJson(existing?.aliasesJson, []) as any[]),
    ...normalizeStringArray(aliases),
    displayName
  ]).slice(0, 24);
  const mergedProperties = {
    ...(safeJson(existing?.propertiesJson, {}) as Record<string, any>),
    ...(properties ?? {})
  };
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO memory_entities (
      entity_id, canonical_name, display_name, entity_type, aliases_json, properties_json, created_at, updated_at
    ) VALUES (
      @entityId, @canonicalName, @displayName, @entityType, @aliasesJson, @propertiesJson,
      COALESCE((SELECT created_at FROM memory_entities WHERE entity_id = @entityId), @now),
      @now
    )
  `).run({
    entityId,
    canonicalName,
    displayName: safeDisplayName,
    entityType: String(entityType ?? "unknown"),
    aliasesJson: JSON.stringify(mergedAliases.map((alias: any) => redactSecrets(alias))),
    propertiesJson: JSON.stringify(redactSecretsDeep(mergedProperties)),
    now
  });

  return getMemoryEntity(db, displayName) ?? {
    entityId,
    canonicalName,
    displayName,
    entityType: String(entityType ?? "unknown"),
    aliases: mergedAliases,
    properties: mergedProperties
  };
}

export function getMemoryEntity(db: any, name: string) {
  const normalized = slugify(name, "entity");
  const rows = db.prepare(`
    SELECT entity_id AS entityId, canonical_name AS canonicalName, display_name AS displayName,
           entity_type AS entityType, aliases_json AS aliasesJson, properties_json AS propertiesJson,
           created_at AS createdAt, updated_at AS updatedAt
    FROM memory_entities
    ORDER BY updated_at DESC
  `).all();
  for (const row of rows) {
    const aliases = safeJson(row.aliasesJson, []);
    if (row.canonicalName === normalized || aliases.some((alias: any) => slugify(alias, "") === normalized)) {
      return {
        ...row,
        aliases,
        properties: safeJson(row.propertiesJson, {})
      };
    }
  }
  return null;
}

export function storeMemoryEntry(db: any, {
  scope = "repo",
  repoId = null,
  sessionId = null,
  wing,
  hall = "events",
  room,
  title,
  summary,
  detail,
  aaak = null,
  tags = [],
  importance = 0.5,
  sourceType = "manual",
  sourceRef = null,
  entities = []
}: Record<string, any>) {
  const safeWing = redactSecrets(String(wing ?? repoId ?? scope));
  const safeTitle = redactSecrets(String(title ?? `${safeWing} ${hall ?? "events"}`));
  const safeSummary = redactSecrets(String(summary ?? clip(detail ?? title ?? "", 220)));
  const safeDetail = redactSecrets(String(detail ?? summary ?? title ?? ""));
  const safeAaak = aaak == null ? null : redactSecrets(String(aaak));
  const normalizedWing = slugify(safeWing, "general");
  const normalizedHall = MEMORY_HALLS.includes(String(hall ?? "").trim())
    ? String(hall).trim()
    : inferHallFromText(`${safeTitle} ${safeSummary}`, hall);
  const normalizedRoom = slugify(redactSecrets(String(room ?? inferRoom(safeTitle ?? safeSummary ?? safeDetail ?? ""))), "general");
  const normalizedTags = unique(normalizeStringArray(tags).map((tag) => redactSecrets(tag))).slice(0, 20);
  const entryId = makeId("memory_entry", `${repoId ?? "global"}:${sessionId ?? "shared"}:${Date.now()}:${safeTitle ?? safeSummary ?? safeDetail}`);
  const now = Date.now();
  const entrySummary = safeSummary;
  const entryDetail = safeDetail;

  db.prepare(`
    INSERT OR REPLACE INTO memory_entries (
      entry_id, scope, repo_id, session_id, wing, hall, room, title, summary, detail, aaak,
      tags_json, importance, source_type, source_ref, created_at, updated_at
    ) VALUES (
      @entryId, @scope, @repoId, @sessionId, @wing, @hall, @room, @title, @summary, @detail, @aaak,
      @tagsJson, @importance, @sourceType, @sourceRef, @now, @now
    )
  `).run({
    entryId,
    scope: String(scope ?? "repo"),
    repoId: repoId ?? null,
    sessionId: sessionId ?? null,
    wing: normalizedWing,
    hall: normalizedHall,
    room: normalizedRoom,
    title: safeTitle,
    summary: entrySummary,
    detail: entryDetail,
    aaak: safeAaak,
    tagsJson: JSON.stringify(normalizedTags),
    importance: clampImportance(importance),
    sourceType: String(sourceType ?? "manual"),
    sourceRef: sourceRef == null ? null : String(sourceRef),
    now
  });

  db.prepare(`DELETE FROM memory_entry_fts WHERE entry_id = ?`).run(entryId);
  db.prepare(`
    INSERT INTO memory_entry_fts (entry_id, title, summary, detail, aaak, tags)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entryId,
    safeTitle,
    entrySummary,
    entryDetail,
    safeAaak == null ? "" : safeAaak,
    normalizedTags.join(" ")
  );

  db.prepare(`DELETE FROM memory_entry_entities WHERE entry_id = ?`).run(entryId);
  for (const entity of normalizeStringArray(entities).map((item) => redactSecrets(item)).slice(0, 8)) {
    const ensured = ensureMemoryEntity(db, { name: entity });
    db.prepare(`
      INSERT OR REPLACE INTO memory_entry_entities (link_id, entry_id, entity_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      makeId("memory_link", `${entryId}:${ensured.entityId}`),
      entryId,
      ensured.entityId,
      "mentioned",
      now
    );
  }

  return getMemoryEntry(db, entryId);
}

export function getMemoryEntry(db: any, entryId: string) {
  const row = db.prepare(`
    SELECT entry_id AS entryId, scope, repo_id AS repoId, session_id AS sessionId, wing, hall, room, title,
           summary, detail, aaak, tags_json AS tagsJson, importance, source_type AS sourceType,
           source_ref AS sourceRef, created_at AS createdAt, updated_at AS updatedAt
    FROM memory_entries
    WHERE entry_id = ?
    LIMIT 1
  `).get(String(entryId));
  if (!row) {
    return null;
  }
  return hydrateMemoryEntry(db, row);
}

export function listRecentMemoryEntries(db: any, {
  repoId = null,
  wing = null,
  hall = null,
  room = null,
  limit = 10
}: Record<string, any> = {}) {
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("repo_id = ?");
    params.push(repoId);
  }
  if (wing) {
    clauses.push("wing = ?");
    params.push(slugify(wing));
  }
  if (hall) {
    clauses.push("hall = ?");
    params.push(String(hall));
  }
  if (room) {
    clauses.push("room = ?");
    params.push(slugify(room));
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT entry_id AS entryId, scope, repo_id AS repoId, session_id AS sessionId, wing, hall, room, title,
           summary, detail, aaak, tags_json AS tagsJson, importance, source_type AS sourceType,
           source_ref AS sourceRef, created_at AS createdAt, updated_at AS updatedAt
    FROM memory_entries
    ${whereSql}
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 30, 10));
  return rows.map((row: any) => hydrateMemoryEntry(db, row));
}

export function searchMemory(db: any, {
  query,
  repoId = null,
  wing = null,
  hall = null,
  room = null,
  limit = 5,
  asOf = null,
  includeDiaries = true
}: Record<string, any>) {
  const normalizedQuery = String(query ?? "").trim();
  const keywords = extractFtsTerms(normalizedQuery).slice(0, 10);
  const temporal = inferTemporalHint(normalizedQuery, asOf);
  const entryRows = keywords.length
    ? queryMemoryEntries(db, { repoId, wing, hall, room, keywords, limit: Math.max(limit * 6, 20) })
    : listRecentMemoryEntries(db, { repoId, wing, hall, room, limit: Math.max(limit * 3, 12) }).map((entry) => ({
        ...entry,
        ftsRank: 1
      }));
  const diaryRows = includeDiaries
    ? queryMemoryDiaries(db, { repoId, keywords, limit: Math.max(limit * 3, 10) })
    : [];
  const factRows = queryMemoryFactsByText(db, { query: normalizedQuery, repoId, limit: Math.max(limit * 2, 8), asOf });

  const combined = [
    ...entryRows.map((entry: any) => ({
      kind: "entry",
      ...entry,
      score: computeMemoryScore({
        title: entry.title,
        summary: entry.summary,
        detail: entry.detail,
        keywords,
        importance: entry.importance,
        createdAt: entry.createdAt,
        ftsRank: entry.ftsRank,
        temporal
      })
    })),
    ...diaryRows.map((diary: any) => ({
      kind: "diary",
      ...diary,
      score: computeMemoryScore({
        title: diary.title,
        summary: diary.entryText,
        detail: diary.entryText,
        keywords,
        importance: 0.45,
        createdAt: diary.createdAt,
        ftsRank: diary.ftsRank,
        temporal
      })
    })),
    ...factRows.map((fact: any) => ({
      kind: "fact",
      ...fact,
      score: computeMemoryScore({
        title: `${fact.subject} ${fact.predicate} ${fact.object}`,
        summary: `${fact.subject} ${fact.predicate} ${fact.object}`,
        detail: `${fact.subject} ${fact.predicate} ${fact.object}`,
        keywords,
        importance: fact.confidence,
        createdAt: fact.createdAt,
        ftsRank: 0.8,
        temporal
      })
    }))
  ];

  combined.sort((left: any, right: any) => right.score - left.score || (right.createdAt ?? 0) - (left.createdAt ?? 0));
  const results = combined.slice(0, clampLimit(limit, 1, 20, 5)).map((entry: any) => {
    if (entry.kind === "fact") {
      return {
        kind: "fact",
        subject: entry.subject,
        predicate: entry.predicate,
        object: entry.object,
        validFrom: entry.validFrom,
        validTo: entry.validTo,
        confidence: entry.confidence,
        preview: clip(`${entry.subject} ${entry.predicate} ${entry.object}`, 220),
        score: Number(entry.score.toFixed(3))
      };
    }
    if (entry.kind === "diary") {
      return {
        kind: "diary",
        diaryId: entry.diaryId,
        title: entry.title,
        preview: clip(entry.entryText.replace(/\s+/g, " ").trim(), 240),
        agentId: entry.agentId,
        tags: entry.tags,
        score: Number(entry.score.toFixed(3))
      };
    }
    return {
      kind: "entry",
      entryId: entry.entryId,
      wing: entry.wing,
      hall: entry.hall,
      room: entry.room,
      title: entry.title,
      preview: clip(entry.summary.replace(/\s+/g, " ").trim(), 240),
      tags: entry.tags,
      entities: entry.entities,
      score: Number(entry.score.toFixed(3))
    };
  });

  return {
    query: normalizedQuery,
    filters: {
      repoId,
      wing: wing ? slugify(wing) : null,
      hall: hall ?? null,
      room: room ? slugify(room) : null,
      asOf: asOf ?? null
    },
    results,
    summary: `Found ${results.length} memory hit${results.length === 1 ? "" : "s"} for "${normalizedQuery}".`
  };
}

export function storeDiaryEntry(db: any, {
  agentId = "claude",
  repoId = null,
  sessionId = null,
  title,
  entryText,
  aaak = null,
  tags = []
}: Record<string, any>) {
  const safeTitle = redactSecrets(String(title ?? "Session diary"));
  const safeEntryText = redactSecrets(String(entryText ?? ""));
  const safeAaak = aaak == null ? null : redactSecrets(String(aaak));
  const safeTags = unique(normalizeStringArray(tags).map((tag) => redactSecrets(tag))).slice(0, 20);
  const diaryId = makeId("memory_diary", `${agentId}:${repoId ?? "global"}:${sessionId ?? "shared"}:${Date.now()}:${safeTitle ?? safeEntryText}`);
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO memory_diaries (
      diary_id, agent_id, repo_id, session_id, title, entry_text, aaak, tags_json, created_at
    ) VALUES (
      @diaryId, @agentId, @repoId, @sessionId, @title, @entryText, @aaak, @tagsJson, @createdAt
    )
  `).run({
    diaryId,
    agentId: String(agentId ?? "claude"),
    repoId: repoId ?? null,
    sessionId: sessionId ?? null,
    title: safeTitle,
    entryText: safeEntryText,
    aaak: safeAaak,
    tagsJson: JSON.stringify(safeTags),
    createdAt: now
  });
  db.prepare(`DELETE FROM memory_diary_fts WHERE diary_id = ?`).run(diaryId);
  db.prepare(`
    INSERT INTO memory_diary_fts (diary_id, title, entry_text, aaak, tags)
    VALUES (?, ?, ?, ?, ?)
  `).run(diaryId, safeTitle, safeEntryText, safeAaak == null ? "" : safeAaak, safeTags.join(" "));
  return getDiaryEntry(db, diaryId);
}

export function readDiaryEntries(db: any, {
  agentId = null,
  repoId = null,
  sessionId = null,
  limit = 10
}: Record<string, any> = {}) {
  const clauses = [];
  const params: any[] = [];
  if (agentId) {
    clauses.push("agent_id = ?");
    params.push(String(agentId));
  }
  if (repoId) {
    clauses.push("repo_id = ?");
    params.push(repoId);
  }
  if (sessionId) {
    clauses.push("session_id = ?");
    params.push(sessionId);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT diary_id AS diaryId, agent_id AS agentId, repo_id AS repoId, session_id AS sessionId,
           title, entry_text AS entryText, aaak, tags_json AS tagsJson, created_at AS createdAt
    FROM memory_diaries
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 30, 10)).map((row: any) => ({
    ...row,
    tags: safeJson(row.tagsJson, [])
  }));
}

export function addMemoryFact(db: any, {
  subject,
  predicate,
  object,
  repoId = null,
  sessionId = null,
  sourceEntryId = null,
  sourceKind = "manual",
  validFrom = null,
  validTo = null,
  confidence = 1,
  metadata = {}
}: Record<string, any>) {
  const safeSubject = redactSecrets(String(subject ?? ""));
  const safeObject = redactSecrets(String(object ?? ""));
  const safePredicate = redactSecrets(String(predicate ?? "related-to"));
  const ensuredSubject = ensureMemoryEntity(db, { name: safeSubject });
  const ensuredObject = ensureMemoryEntity(db, { name: safeObject });
  const normalizedPredicate = slugify(safePredicate, "related-to").replace(/-/g, "_");
  const existing = db.prepare(`
    SELECT triple_id AS tripleId
    FROM memory_triples
    WHERE subject_entity_id = ? AND predicate = ? AND object_entity_id = ? AND IFNULL(valid_to, '') = IFNULL(?, '')
    LIMIT 1
  `).get(ensuredSubject.entityId, normalizedPredicate, ensuredObject.entityId, validTo ?? null);
  const tripleId = existing?.tripleId ?? makeId("memory_fact", `${ensuredSubject.entityId}:${normalizedPredicate}:${ensuredObject.entityId}:${validFrom ?? "na"}:${Date.now()}`);
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO memory_triples (
      triple_id, subject_entity_id, predicate, object_entity_id, repo_id, session_id, source_entry_id,
      source_kind, valid_from, valid_to, confidence, metadata_json, created_at, updated_at
    ) VALUES (
      @tripleId, @subjectEntityId, @predicate, @objectEntityId, @repoId, @sessionId, @sourceEntryId,
      @sourceKind, @validFrom, @validTo, @confidence, @metadataJson,
      COALESCE((SELECT created_at FROM memory_triples WHERE triple_id = @tripleId), @now),
      @now
    )
  `).run({
    tripleId,
    subjectEntityId: ensuredSubject.entityId,
    predicate: normalizedPredicate,
    objectEntityId: ensuredObject.entityId,
    repoId: repoId ?? null,
    sessionId: sessionId ?? null,
    sourceEntryId: sourceEntryId ?? null,
    sourceKind: String(sourceKind ?? "manual"),
    validFrom: validFrom ?? null,
    validTo: validTo ?? null,
    confidence: clampImportance(confidence),
    metadataJson: JSON.stringify(redactSecretsDeep(metadata ?? {})),
    now
  });

  return queryMemoryFacts(db, { entity: subject, direction: "outgoing" })
    .find((fact: any) => fact.predicate === normalizedPredicate && fact.object === ensuredObject.displayName)
    ?? { tripleId, subject: ensuredSubject.displayName, predicate: normalizedPredicate, object: ensuredObject.displayName };
}

export function invalidateMemoryFact(db: any, {
  subject,
  predicate,
  object,
  ended = null
}: Record<string, any>) {
  const ensuredSubject = getMemoryEntity(db, subject);
  const ensuredObject = getMemoryEntity(db, object);
  if (!ensuredSubject || !ensuredObject) {
    return { invalidated: 0 };
  }
  const normalizedPredicate = slugify(predicate, "related-to").replace(/-/g, "_");
  const endedValue = ended ?? new Date().toISOString().slice(0, 10);
  const result = db.prepare(`
    UPDATE memory_triples
    SET valid_to = ?, updated_at = ?
    WHERE subject_entity_id = ? AND predicate = ? AND object_entity_id = ? AND valid_to IS NULL
  `).run(endedValue, Date.now(), ensuredSubject.entityId, normalizedPredicate, ensuredObject.entityId);
  return {
    invalidated: result.changes ?? 0,
    subject: ensuredSubject.displayName,
    predicate: normalizedPredicate,
    object: ensuredObject.displayName,
    ended: endedValue
  };
}

export function queryMemoryFacts(db: any, {
  entity,
  asOf = null,
  direction = "both"
}: Record<string, any>) {
  const ensured = getMemoryEntity(db, entity);
  if (!ensured) {
    return [];
  }
  const results: any[] = [];
  const timestampClause = asOf
    ? " AND (t.valid_from IS NULL OR t.valid_from <= ?) AND (t.valid_to IS NULL OR t.valid_to >= ?)"
    : "";
  const timestampParams = asOf ? [asOf, asOf] : [];

  if (direction === "outgoing" || direction === "both") {
    const rows = db.prepare(`
      SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
             t.confidence, t.created_at AS createdAt, o.display_name AS objectName
      FROM memory_triples t
      JOIN memory_entities o ON o.entity_id = t.object_entity_id
      WHERE t.subject_entity_id = ?${timestampClause}
      ORDER BY t.valid_from DESC, t.created_at DESC
    `).all(ensured.entityId, ...timestampParams);
    for (const row of rows) {
      results.push({
        direction: "outgoing",
        tripleId: row.tripleId,
        subject: ensured.displayName,
        predicate: row.predicate,
        object: row.objectName,
        validFrom: row.validFrom,
        validTo: row.validTo,
        confidence: row.confidence,
        createdAt: row.createdAt,
        current: row.validTo == null
      });
    }
  }

  if (direction === "incoming" || direction === "both") {
    const rows = db.prepare(`
      SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
             t.confidence, t.created_at AS createdAt, s.display_name AS subjectName
      FROM memory_triples t
      JOIN memory_entities s ON s.entity_id = t.subject_entity_id
      WHERE t.object_entity_id = ?${timestampClause}
      ORDER BY t.valid_from DESC, t.created_at DESC
    `).all(ensured.entityId, ...timestampParams);
    for (const row of rows) {
      results.push({
        direction: "incoming",
        tripleId: row.tripleId,
        subject: row.subjectName,
        predicate: row.predicate,
        object: ensured.displayName,
        validFrom: row.validFrom,
        validTo: row.validTo,
        confidence: row.confidence,
        createdAt: row.createdAt,
        current: row.validTo == null
      });
    }
  }

  return results;
}

export function memoryTimeline(db: any, entity: string | null = null) {
  const clauses = [];
  const params: any[] = [];
  if (entity) {
    const ensured = getMemoryEntity(db, entity);
    if (!ensured) {
      return [];
    }
    clauses.push("(t.subject_entity_id = ? OR t.object_entity_id = ?)");
    params.push(ensured.entityId, ensured.entityId);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    ${whereSql}
    ORDER BY COALESCE(t.valid_from, ''), t.created_at
  `).all(...params).map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate: row.predicate,
    object: row.objectName,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    createdAt: row.createdAt,
    current: row.validTo == null
  }));
}

export function listActiveFacts(db: any, repoId: string | null = null, limit = 8) {
  const clauses = ["t.valid_to IS NULL"];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(t.repo_id = ? OR t.repo_id IS NULL)");
    params.push(repoId);
  }
  return db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.confidence DESC, t.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 20, 8)).map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate: row.predicate,
    object: row.objectName,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    createdAt: row.createdAt,
    current: true
  }));
}

export function recordMemoryCheckpoint(db: any, {
  repoId = null,
  sessionId = null,
  kind = "autosave",
  lastEventId = null,
  lastEventAt = null,
  entryId = null
}: Record<string, any>) {
  const checkpointId = makeId("memory_checkpoint", `${repoId ?? "global"}:${sessionId ?? "shared"}:${kind}:${Date.now()}`);
  db.prepare(`
    INSERT OR REPLACE INTO memory_checkpoints (
      checkpoint_id, repo_id, session_id, kind, last_event_id, last_event_at, entry_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    checkpointId,
    repoId ?? null,
    sessionId ?? null,
    String(kind ?? "autosave"),
    lastEventId ?? null,
    lastEventAt ?? null,
    entryId ?? null,
    Date.now()
  );
  return {
    checkpointId,
    repoId,
    sessionId,
    kind,
    lastEventId,
    lastEventAt,
    entryId
  };
}

export function getLatestMemoryCheckpoint(db: any, {
  repoId = null,
  sessionId = null,
  kind = "autosave"
}: Record<string, any> = {}) {
  const row = db.prepare(`
    SELECT checkpoint_id AS checkpointId, repo_id AS repoId, session_id AS sessionId, kind,
           last_event_id AS lastEventId, last_event_at AS lastEventAt, entry_id AS entryId, created_at AS createdAt
    FROM memory_checkpoints
    WHERE IFNULL(repo_id, '') = IFNULL(?, '')
      AND IFNULL(session_id, '') = IFNULL(?, '')
      AND kind = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(repoId ?? null, sessionId ?? null, String(kind ?? "autosave"));
  return row ?? null;
}

export function getMemoryStats(db: any, repoId: string | null = null) {
  const entryCount = repoId
    ? db.prepare(`SELECT COUNT(*) AS count FROM memory_entries WHERE repo_id = ? OR repo_id IS NULL`).get(repoId).count
    : db.prepare(`SELECT COUNT(*) AS count FROM memory_entries`).get().count;
  const diaryCount = repoId
    ? db.prepare(`SELECT COUNT(*) AS count FROM memory_diaries WHERE repo_id = ? OR repo_id IS NULL`).get(repoId).count
    : db.prepare(`SELECT COUNT(*) AS count FROM memory_diaries`).get().count;
  const tripleCount = repoId
    ? db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE repo_id = ? OR repo_id IS NULL`).get(repoId).count
    : db.prepare(`SELECT COUNT(*) AS count FROM memory_triples`).get().count;
  const activeFactCount = repoId
    ? db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE valid_to IS NULL AND (repo_id = ? OR repo_id IS NULL)`).get(repoId).count
    : db.prepare(`SELECT COUNT(*) AS count FROM memory_triples WHERE valid_to IS NULL`).get().count;
  return {
    profiles: db.prepare(`SELECT COUNT(*) AS count FROM memory_profiles`).get().count,
    entries: entryCount,
    diaries: diaryCount,
    entities: db.prepare(`SELECT COUNT(*) AS count FROM memory_entities`).get().count,
    facts: tripleCount,
    activeFacts: activeFactCount,
    checkpoints: db.prepare(`SELECT COUNT(*) AS count FROM memory_checkpoints`).get().count
  };
}

function queryMemoryEntries(db: any, {
  repoId,
  wing,
  hall,
  room,
  keywords,
  limit
}: Record<string, any>) {
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(e.repo_id = ? OR e.repo_id IS NULL)");
    params.push(repoId);
  }
  if (wing) {
    clauses.push("e.wing = ?");
    params.push(slugify(wing));
  }
  if (hall) {
    clauses.push("e.hall = ?");
    params.push(String(hall));
  }
  if (room) {
    clauses.push("e.room = ?");
    params.push(slugify(room));
  }
  const matchQuery = keywords.map((token: string) => `"${token.replace(/"/g, "\"\"")}"*`).join(" OR ");
  clauses.push("memory_entry_fts MATCH ?");
  params.push(matchQuery);
  const rows = db.prepare(`
    SELECT e.entry_id AS entryId, e.scope, e.repo_id AS repoId, e.session_id AS sessionId, e.wing, e.hall, e.room,
           e.title, e.summary, e.detail, e.aaak, e.tags_json AS tagsJson, e.importance, e.source_type AS sourceType,
           e.source_ref AS sourceRef, e.created_at AS createdAt, e.updated_at AS updatedAt,
           bm25(memory_entry_fts) AS ftsRank
    FROM memory_entry_fts
    JOIN memory_entries e ON e.entry_id = memory_entry_fts.entry_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ftsRank ASC, e.importance DESC, e.updated_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 100, 25));
  return rows.map((row: any) => ({
    ...hydrateMemoryEntry(db, row),
    ftsRank: Number(row.ftsRank ?? 1)
  }));
}

function queryMemoryDiaries(db: any, {
  repoId,
  keywords,
  limit
}: Record<string, any>) {
  if (!keywords?.length) {
    return [];
  }
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(d.repo_id = ? OR d.repo_id IS NULL)");
    params.push(repoId);
  }
  const matchQuery = keywords.map((token: string) => `"${token.replace(/"/g, "\"\"")}"*`).join(" OR ");
  clauses.push("memory_diary_fts MATCH ?");
  params.push(matchQuery);
  return db.prepare(`
    SELECT d.diary_id AS diaryId, d.agent_id AS agentId, d.repo_id AS repoId, d.session_id AS sessionId,
           d.title, d.entry_text AS entryText, d.aaak, d.tags_json AS tagsJson, d.created_at AS createdAt,
           bm25(memory_diary_fts) AS ftsRank
    FROM memory_diary_fts
    JOIN memory_diaries d ON d.diary_id = memory_diary_fts.diary_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ftsRank ASC, d.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 60, 15)).map((row: any) => ({
    ...row,
    tags: safeJson(row.tagsJson, []),
    ftsRank: Number(row.ftsRank ?? 1)
  }));
}

function queryMemoryFactsByText(db: any, {
  query,
  repoId = null,
  limit = 8,
  asOf = null
}: Record<string, any>) {
  const normalized = String(query ?? "").trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const like = `%${normalized.replace(/\s+/g, "%")}%`;
  const clauses = [
    "(lower(s.display_name) LIKE ? OR lower(o.display_name) LIKE ? OR lower(t.predicate) LIKE ?)"
  ];
  const params: any[] = [like, like, like];
  if (repoId) {
    clauses.push("(t.repo_id = ? OR t.repo_id IS NULL)");
    params.push(repoId);
  }
  if (asOf) {
    clauses.push("(t.valid_from IS NULL OR t.valid_from <= ?)");
    clauses.push("(t.valid_to IS NULL OR t.valid_to >= ?)");
    params.push(asOf, asOf);
  }
  return db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.confidence DESC, t.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 30, 8)).map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate: row.predicate,
    object: row.objectName,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    createdAt: row.createdAt
  }));
}

function computeMemoryScore({
  title,
  summary,
  detail,
  keywords,
  importance,
  createdAt,
  ftsRank,
  temporal
}: Record<string, any>) {
  const bag = tokenize(`${title ?? ""} ${summary ?? ""} ${detail ?? ""}`);
  const keywordScore = !keywords?.length
    ? 0
    : keywords.filter((token: string) => bag.includes(token)).length / keywords.length;
  const base = 1 / (1 + Math.max(0, Number(ftsRank ?? 1)));
  const importanceScore = clampImportance(importance);
  const recencyDays = Math.max(0, (Date.now() - Number(createdAt ?? Date.now())) / 86400000);
  const recencyScore = 1 / (1 + recencyDays / 30);
  const temporalScore = temporal ? temporalMatchScore(temporal, createdAt) : 0;
  return (base * 0.42) + (keywordScore * 0.28) + (importanceScore * 0.15) + (recencyScore * 0.1) + (temporalScore * 0.05);
}

function hydrateMemoryEntry(db: any, row: any) {
  return {
    ...row,
    tags: safeJson(row.tagsJson, []),
    entities: db.prepare(`
      SELECT e.display_name AS displayName
      FROM memory_entry_entities l
      JOIN memory_entities e ON e.entity_id = l.entity_id
      WHERE l.entry_id = ?
      ORDER BY e.display_name ASC
    `).all(row.entryId).map((entity: any) => entity.displayName)
  };
}

function getDiaryEntry(db: any, diaryId: string) {
  return db.prepare(`
    SELECT diary_id AS diaryId, agent_id AS agentId, repo_id AS repoId, session_id AS sessionId,
           title, entry_text AS entryText, aaak, tags_json AS tagsJson, created_at AS createdAt
    FROM memory_diaries
    WHERE diary_id = ?
    LIMIT 1
  `).get(diaryId);
}

function inferTemporalHint(query: string, asOf: string | null) {
  if (asOf) {
    return {
      targetAt: Date.parse(asOf),
      windowMs: 7 * 86400000
    };
  }

  const text = String(query ?? "").toLowerCase();
  const now = Date.now();
  if (/yesterday/.test(text)) {
    return { targetAt: now - 86400000, windowMs: 2 * 86400000 };
  }
  if (/last week|a week ago/.test(text)) {
    return { targetAt: now - (7 * 86400000), windowMs: 10 * 86400000 };
  }
  if (/last month|a month ago/.test(text)) {
    return { targetAt: now - (30 * 86400000), windowMs: 40 * 86400000 };
  }
  if (/recent|recently|today|current/.test(text)) {
    return { targetAt: now, windowMs: 5 * 86400000 };
  }
  return null;
}

function temporalMatchScore(temporal: any, createdAt: any) {
  if (!temporal?.targetAt || !createdAt) {
    return 0;
  }
  const distance = Math.abs(Number(createdAt) - Number(temporal.targetAt));
  if (distance > temporal.windowMs) {
    return 0;
  }
  return 1 - (distance / temporal.windowMs);
}

function inferHallFromText(text: string, fallback = "events") {
  const value = String(text ?? "").toLowerCase();
  if (/\b(prefer|preference|like|dislike|usually|always)\b/.test(value)) {
    return "preferences";
  }
  if (/\b(decision|fact|agreed|confirmed|locked|chosen)\b/.test(value)) {
    return "facts";
  }
  if (/\b(discover|learned|breakthrough|root cause|insight)\b/.test(value)) {
    return "discoveries";
  }
  if (/\b(recommend|should|advice|suggest|guidance)\b/.test(value)) {
    return "advice";
  }
  return MEMORY_HALLS.includes(String(fallback)) ? String(fallback) : "events";
}

function inferRoom(text: string) {
  const tokens = tokenize(text).filter((token) => token.length > 2).slice(0, 4);
  return tokens.length ? tokens.join("-") : "general";
}

function normalizeStringArray(value: any) {
  if (!Array.isArray(value)) {
    return String(value ?? "").trim() ? [String(value).trim()] : [];
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function extractFtsTerms(query: string) {
  return unique(tokenize(query)
    .flatMap((token) => token.split(/[^a-z0-9_]+/g))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2));
}

function safeJson(text: any, fallback: any) {
  try {
    return text == null ? fallback : JSON.parse(String(text));
  } catch {
    return fallback;
  }
}

function clampLimit(value: any, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function clampImportance(value: any) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, parsed));
}
