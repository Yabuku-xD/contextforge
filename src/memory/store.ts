import { makeId } from "../indexing/canonicalize.js";
import { embedText } from "../retrieval/vectors.js";
import { clip, cosineSimilarity, normalizeIdentifier, tokenize, unique } from "../utils/text.js";
import { redactSecrets, redactSecretsDeep } from "../session/redaction.js";

export const MEMORY_HALLS = ["facts", "events", "discoveries", "preferences", "advice", "diary"];

const EXCLUSIVE_PREDICATE_PATTERNS = [
  /(^|_)is$/,
  /(^|_)(was|became|status|state)$/,
  /(^|_)(current|active|default|preferred|primary|latest|selected|chosen)/,
  /(owner|assignee|assigned|working_on|branch|version|lives_in|located_in|repo_root)/
];

const NON_EXCLUSIVE_PREDICATES = new Set([
  "related_to",
  "uses",
  "depends_on",
  "mentions",
  "references",
  "contains",
  "supports",
  "knows",
  "likes"
]);

const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  sqlite: ["database", "sql", "storage", "backend", "persistence", "persistent"],
  database: ["sqlite", "sql", "storage", "backend", "db", "persistence", "persistent"],
  db: ["database", "sqlite", "storage", "backend"],
  storage: ["database", "sqlite", "persistence", "backend"],
  backend: ["database", "storage", "sqlite"],
  persistent: ["durable", "saved", "long_term", "storage"],
  durable: ["persistent", "saved", "lasting", "long_term"],
  recall: ["memory", "remembered", "retrieval"],
  memory: ["recall", "history", "remembered", "durable"],
  repo: ["repository", "project", "codebase"],
  repository: ["repo", "project", "codebase"],
  project: ["repo", "repository", "codebase"],
  auth: ["authentication", "login", "credential"],
  authentication: ["auth", "login", "credential"],
  cli: ["command", "terminal", "shell", "console"],
  terminal: ["cli", "shell", "console"],
  shell: ["bash", "terminal", "cli"],
  decision: ["choice", "selected", "picked", "agreed"],
  issue: ["bug", "problem", "failure"],
  error: ["failure", "problem", "bug"],
  fact: ["truth", "state", "decision"],
  diary: ["journal", "checkpoint", "notes"]
};

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
  const entrySummary = safeSummary;
  const entryDetail = safeDetail;
  const semanticJson = JSON.stringify(buildSemanticSignature({
    wing: normalizedWing,
    hall: normalizedHall,
    room: normalizedRoom,
    title: safeTitle,
    summary: entrySummary,
    detail: entryDetail,
    tags: normalizedTags,
    entities
  }));
  const embeddingJson = JSON.stringify(buildMemoryEmbedding({
    wing: normalizedWing,
    hall: normalizedHall,
    room: normalizedRoom,
    title: safeTitle,
    summary: entrySummary,
    detail: entryDetail,
    aaak: safeAaak,
    tags: normalizedTags,
    entities
  }));
  const entryId = makeId("memory_entry", `${repoId ?? "global"}:${sessionId ?? "shared"}:${Date.now()}:${safeTitle ?? safeSummary ?? safeDetail}`);
  const now = Date.now();

  db.prepare(`
    INSERT OR REPLACE INTO memory_entries (
      entry_id, scope, repo_id, session_id, wing, hall, room, title, summary, detail, aaak, semantic_json, embedding_json,
      tags_json, importance, source_type, source_ref, created_at, updated_at
    ) VALUES (
      @entryId, @scope, @repoId, @sessionId, @wing, @hall, @room, @title, @summary, @detail, @aaak, @semanticJson, @embeddingJson,
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
    semanticJson,
    embeddingJson,
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
           summary, detail, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson, importance, source_type AS sourceType,
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
           summary, detail, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson, importance, source_type AS sourceType,
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
  const normalizedWing = wing ? slugify(wing) : null;
  const normalizedRoom = room ? slugify(room) : null;
  const keywords = extractFtsTerms(normalizedQuery).slice(0, 10);
  const queryEmbedding = buildMemoryEmbedding({
    wing: normalizedWing ?? "",
    hall: hall ?? "",
    room: normalizedRoom ?? "",
    title: normalizedQuery,
    detail: normalizedQuery
  });
  const semanticQuery = buildSemanticSignature({
    wing: normalizedWing ?? "",
    hall: hall ?? "",
    room: normalizedRoom ?? "",
    title: normalizedQuery,
    detail: normalizedQuery
  });
  const temporal = inferTemporalHint(normalizedQuery, asOf);
  const matchedEntities = normalizedQuery
    ? searchMemoryEntities(db, { query: normalizedQuery, repoId, limit: Math.max(limit * 2, 6) })
    : [];
  const entityIds = matchedEntities.map((entity: any) => entity.entityId);

  const entryRows = dedupeRows([
    ...(keywords.length
      ? queryMemoryEntries(db, { repoId, wing: normalizedWing, hall, room: normalizedRoom, keywords, limit: Math.max(limit * 6, 20) })
      : []),
    ...queryEntriesByEntityIds(db, { repoId, wing: normalizedWing, hall, room: normalizedRoom, entityIds, limit: Math.max(limit * 4, 18) }),
    ...listSemanticMemoryEntries(db, { repoId, wing: normalizedWing, hall, room: normalizedRoom, limit: Math.max(limit * 12, 48) })
  ], "entryId");

  const diaryRows = includeDiaries
    ? dedupeRows([
        ...(keywords.length
          ? queryMemoryDiaries(db, { repoId, keywords, limit: Math.max(limit * 3, 10) })
          : []),
        ...listSemanticDiaryEntries(db, { repoId, limit: Math.max(limit * 6, 24) })
      ], "diaryId")
    : [];

  const factRows = dedupeRows([
    ...queryMemoryFactsByText(db, { query: normalizedQuery, repoId, limit: Math.max(limit * 2, 8), asOf }),
    ...queryFactsByEntityIds(db, { repoId, entityIds, asOf, limit: Math.max(limit * 3, 12) }),
    ...listSemanticFacts(db, { repoId, asOf, limit: Math.max(limit * 8, 32) })
  ], "tripleId");

  const combined = [
    ...entryRows.map((entry: any) => {
      const vectorScore = cosineSimilarity(queryEmbedding, normalizeEmbedding(entry.embedding));
      const semanticScore = signatureCosine(semanticQuery, entry.semantic);
      const provenanceScore = entryMemoryProvenanceScore(entry);
      const entityScore = entityAssociationScore(entry.entities, matchedEntities);
      const graphScore = topologyScore(entry, { wing: normalizedWing, hall, room: normalizedRoom });
      return {
        kind: "entry",
        ...entry,
        vectorScore,
        semanticScore,
        provenanceScore,
        entityScore,
        graphScore,
        score: computeMemoryScore({
          title: entry.title,
          summary: entry.summary,
          detail: entry.detail,
          keywords,
          importance: entry.importance,
          createdAt: entry.createdAt,
          ftsRank: entry.ftsRank,
          temporal,
          vectorScore,
          semanticScore,
          provenanceScore,
          entityScore,
          graphScore
        })
      };
    }),
    ...diaryRows.map((diary: any) => {
      const vectorScore = cosineSimilarity(queryEmbedding, normalizeEmbedding(diary.embedding));
      const semanticScore = signatureCosine(semanticQuery, diary.semantic);
      const provenanceScore = diaryMemoryProvenanceScore(diary);
      return {
        kind: "diary",
        ...diary,
        vectorScore,
        semanticScore,
        provenanceScore,
        score: computeMemoryScore({
          title: diary.title,
          summary: diary.entryText,
          detail: diary.entryText,
          keywords,
          importance: 0.45,
          createdAt: diary.createdAt,
          ftsRank: diary.ftsRank,
          temporal,
          vectorScore,
          semanticScore,
          provenanceScore
        })
      };
    }),
    ...factRows.map((fact: any) => {
      const vectorScore = cosineSimilarity(queryEmbedding, normalizeEmbedding(fact.embedding));
      const semanticScore = signatureCosine(semanticQuery, buildSemanticSignature({
        title: `${fact.subject} ${fact.predicate} ${fact.object}`,
        detail: `${fact.subject} ${fact.predicate} ${fact.object}`
      }));
      const provenanceScore = factMemoryProvenanceScore(fact);
      const entityScore = factEntityScore(fact, matchedEntities);
      const graphScore = topologyScore(fact, { wing: normalizedWing, hall, room: normalizedRoom });
      const contradictionPenalty = factContradictionPenalty(fact);
      return {
        kind: "fact",
        ...fact,
        vectorScore,
        semanticScore,
        provenanceScore,
        entityScore,
        graphScore,
        contradictionPenalty,
        score: computeMemoryScore({
          title: `${fact.subject} ${fact.predicate} ${fact.object}`,
          summary: `${fact.subject} ${fact.predicate} ${fact.object}`,
          detail: `${fact.subject} ${fact.predicate} ${fact.object}`,
          keywords,
          importance: fact.confidence,
          createdAt: fact.createdAt,
          ftsRank: 0.8,
          temporal,
          vectorScore,
          semanticScore,
          provenanceScore,
          entityScore,
          graphScore,
          contradictionPenalty
        })
      };
    })
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
        current: entry.current,
        conflicted: Boolean(entry.conflicted),
        preview: clip(`${entry.subject} ${entry.predicate} ${entry.object}`, 220),
        vectorScore: Number((entry.vectorScore ?? 0).toFixed(3)),
        semanticScore: Number((entry.semanticScore ?? 0).toFixed(3)),
        provenanceScore: Number((entry.provenanceScore ?? 0).toFixed(3)),
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
        vectorScore: Number((entry.vectorScore ?? 0).toFixed(3)),
        semanticScore: Number((entry.semanticScore ?? 0).toFixed(3)),
        provenanceScore: Number((entry.provenanceScore ?? 0).toFixed(3)),
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
      vectorScore: Number((entry.vectorScore ?? 0).toFixed(3)),
      semanticScore: Number((entry.semanticScore ?? 0).toFixed(3)),
      provenanceScore: Number((entry.provenanceScore ?? 0).toFixed(3)),
      score: Number(entry.score.toFixed(3))
    };
  });

  return {
    query: normalizedQuery,
    filters: {
      repoId,
      wing: normalizedWing,
      hall: hall ?? null,
      room: normalizedRoom,
      asOf: asOf ?? null
    },
    matchedEntities: matchedEntities.map((entity: any) => ({
      entityId: entity.entityId,
      displayName: entity.displayName,
      entityType: entity.entityType,
      score: Number(entity.score.toFixed(3))
    })),
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
  const semanticJson = JSON.stringify(buildSemanticSignature({
    wing: repoId ?? "global",
    hall: "diary",
    room: agentId,
    title: safeTitle,
    detail: safeEntryText,
    aaak: safeAaak,
    tags: safeTags
  }));
  const embeddingJson = JSON.stringify(buildMemoryEmbedding({
    wing: repoId ?? "global",
    hall: "diary",
    room: agentId,
    title: safeTitle,
    detail: safeEntryText,
    aaak: safeAaak,
    tags: safeTags
  }));
  const diaryId = makeId("memory_diary", `${agentId}:${repoId ?? "global"}:${sessionId ?? "shared"}:${Date.now()}:${safeTitle ?? safeEntryText}`);
  const now = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO memory_diaries (
      diary_id, agent_id, repo_id, session_id, title, entry_text, aaak, semantic_json, embedding_json, tags_json, created_at
    ) VALUES (
      @diaryId, @agentId, @repoId, @sessionId, @title, @entryText, @aaak, @semanticJson, @embeddingJson, @tagsJson, @createdAt
    )
  `).run({
    diaryId,
    agentId: String(agentId ?? "claude"),
    repoId: repoId ?? null,
    sessionId: sessionId ?? null,
    title: safeTitle,
    entryText: safeEntryText,
    aaak: safeAaak,
    semanticJson,
    embeddingJson,
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
           title, entry_text AS entryText, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson, created_at AS createdAt
    FROM memory_diaries
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 30, 10)).map((row: any) => ({
    ...row,
    tags: safeJson(row.tagsJson, []),
    semantic: safeJson(row.semanticJson, {}),
    embedding: safeJson(row.embeddingJson, [])
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
  metadata = {},
  invalidateConflicts = "auto"
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
  const embeddingJson = JSON.stringify(buildMemoryEmbedding({
    title: `${safeSubject} ${safePredicate} ${safeObject}`,
    detail: `${safeSubject} ${safePredicate} ${safeObject}`,
    tags: [safePredicate],
    entities: [safeSubject, safeObject]
  }));
  const supersededFacts = shouldInvalidateFactConflicts(normalizedPredicate, metadata, invalidateConflicts)
    ? invalidateConflictingFacts(db, {
        subjectEntityId: ensuredSubject.entityId,
        predicate: normalizedPredicate,
        objectEntityId: ensuredObject.entityId,
        ended: validFrom ?? new Date().toISOString().slice(0, 10)
      })
    : [];
  db.prepare(`
    INSERT OR REPLACE INTO memory_triples (
      triple_id, subject_entity_id, predicate, object_entity_id, repo_id, session_id, source_entry_id,
      source_kind, valid_from, valid_to, confidence, metadata_json, embedding_json, created_at, updated_at
    ) VALUES (
      @tripleId, @subjectEntityId, @predicate, @objectEntityId, @repoId, @sessionId, @sourceEntryId,
      @sourceKind, @validFrom, @validTo, @confidence, @metadataJson, @embeddingJson,
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
    embeddingJson,
    now
  });

  const stored = queryMemoryFacts(db, { entity: subject, direction: "outgoing" })
    .find((fact: any) => fact.predicate === normalizedPredicate && fact.object === ensuredObject.displayName)
    ?? {
      tripleId,
      subject: ensuredSubject.displayName,
      predicate: normalizedPredicate,
      object: ensuredObject.displayName,
      current: validTo == null,
      conflicted: false
    };
  return {
    ...stored,
    supersededFacts
  };
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
             t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
             t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, o.display_name AS objectName
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
        sourceKind: row.sourceKind,
        sourceEntryId: row.sourceEntryId,
        metadata: safeJson(row.metadataJson, {}),
        embedding: safeJson(row.embeddingJson, []),
        createdAt: row.createdAt,
        current: row.validTo == null
      });
    }
  }

  if (direction === "incoming" || direction === "both") {
    const rows = db.prepare(`
      SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
             t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
             t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName
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
        sourceKind: row.sourceKind,
        sourceEntryId: row.sourceEntryId,
        metadata: safeJson(row.metadataJson, {}),
        embedding: safeJson(row.embeddingJson, []),
        createdAt: row.createdAt,
        current: row.validTo == null
      });
    }
  }

  return annotateFactConflicts(results);
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
  return annotateFactConflicts(db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
           t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName, o.display_name AS objectName
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
    sourceKind: row.sourceKind,
    sourceEntryId: row.sourceEntryId,
    metadata: safeJson(row.metadataJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    createdAt: row.createdAt,
    current: row.validTo == null
  })));
}

export function listActiveFacts(db: any, repoId: string | null = null, limit = 8) {
  const clauses = ["t.valid_to IS NULL"];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(t.repo_id = ? OR t.repo_id IS NULL)");
    params.push(repoId);
  }
  return annotateFactConflicts(db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
           t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName, o.display_name AS objectName
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
    sourceKind: row.sourceKind,
    sourceEntryId: row.sourceEntryId,
    metadata: safeJson(row.metadataJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    createdAt: row.createdAt,
    current: true
  })));
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

export function navigateMemory(db: any, {
  repoId = null,
  wing = null,
  hall = null,
  room = null,
  limit = 8
}: Record<string, any> = {}) {
  const normalizedWing = wing ? slugify(wing) : null;
  const normalizedRoom = room ? slugify(room) : null;
  const wings = groupedEntryTopology(db, {
    repoId,
    by: "wing",
    limit: clampLimit(limit, 1, 20, 8)
  });
  const halls = normalizedWing
    ? groupedEntryTopology(db, {
        repoId,
        wing: normalizedWing,
        by: "hall",
        limit: clampLimit(limit, 1, 20, 8)
      })
    : [];
  const rooms = normalizedWing && hall
    ? groupedEntryTopology(db, {
        repoId,
        wing: normalizedWing,
        hall,
        by: "room",
        limit: clampLimit(limit, 1, 20, 10)
      })
    : [];
  const entries = listRecentMemoryEntries(db, {
    repoId,
    wing: normalizedWing,
    hall,
    room: normalizedRoom,
    limit: clampLimit(limit, 1, 20, 8)
  });
  const entityNames = unique(entries.flatMap((entry: any) => entry.entities ?? [])).slice(0, 8);
  const facts = entityNames.length
    ? annotateFactConflicts(dedupeRows(entityNames.flatMap((entityName) => queryMemoryFacts(db, { entity: entityName, direction: "both" })), "tripleId"))
        .sort((left: any, right: any) => Number(right.current) - Number(left.current) || Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))
        .slice(0, 8)
    : [];

  return {
    path: {
      wing: normalizedWing,
      hall: hall ?? null,
      room: normalizedRoom
    },
    topology: {
      wings,
      halls,
      rooms
    },
    entries: entries.map((entry: any) => ({
      entryId: entry.entryId,
      wing: entry.wing,
      hall: entry.hall,
      room: entry.room,
      title: entry.title,
      preview: clip(entry.summary, 220),
      tags: entry.tags,
      entities: entry.entities
    })),
    relatedFacts: facts.map((fact: any) => ({
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      current: fact.current,
      conflicted: Boolean(fact.conflicted)
    })),
    summary: buildNavigationSummary({ normalizedWing, hall, normalizedRoom, wings, halls, rooms, entryCount: entries.length })
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
           e.title, e.summary, e.detail, e.aaak, e.semantic_json AS semanticJson, e.embedding_json AS embeddingJson, e.tags_json AS tagsJson, e.importance, e.source_type AS sourceType,
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
           d.title, d.entry_text AS entryText, d.aaak, d.semantic_json AS semanticJson, d.embedding_json AS embeddingJson, d.tags_json AS tagsJson, d.created_at AS createdAt,
           bm25(memory_diary_fts) AS ftsRank
    FROM memory_diary_fts
    JOIN memory_diaries d ON d.diary_id = memory_diary_fts.diary_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ftsRank ASC, d.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 60, 15)).map((row: any) => ({
    ...row,
    tags: safeJson(row.tagsJson, []),
    semantic: safeJson(row.semanticJson, {}),
    embedding: safeJson(row.embeddingJson, []),
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
  return annotateFactConflicts(db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
           t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName, o.display_name AS objectName
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
    sourceKind: row.sourceKind,
    sourceEntryId: row.sourceEntryId,
    metadata: safeJson(row.metadataJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    createdAt: row.createdAt,
    current: row.validTo == null
  })));
}

function computeMemoryScore({
  title,
  summary,
  detail,
  keywords,
  importance,
  createdAt,
  ftsRank,
  temporal,
  vectorScore = 0,
  semanticScore = 0,
  provenanceScore = 0,
  entityScore = 0,
  graphScore = 0,
  contradictionPenalty = 0
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
  return Math.max(0, (base * 0.22)
    + (keywordScore * 0.12)
    + (clampImportance(vectorScore) * 0.2)
    + (clampImportance(semanticScore) * 0.18)
    + (clampImportance(provenanceScore) * 0.14)
    + (clampImportance(entityScore) * 0.1)
    + (clampImportance(graphScore) * 0.08)
    + (importanceScore * 0.1)
    + (recencyScore * 0.04)
    + (temporalScore * 0.02)
    - (clampImportance(contradictionPenalty) * 0.1));
}

function hydrateMemoryEntry(db: any, row: any) {
  return {
    ...row,
    tags: safeJson(row.tagsJson, []),
    semantic: safeJson(row.semanticJson, {}),
    embedding: safeJson(row.embeddingJson, []),
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
  const row = db.prepare(`
    SELECT diary_id AS diaryId, agent_id AS agentId, repo_id AS repoId, session_id AS sessionId,
           title, entry_text AS entryText, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson, created_at AS createdAt
    FROM memory_diaries
    WHERE diary_id = ?
    LIMIT 1
  `).get(diaryId);
  if (!row) {
    return null;
  }
  return {
    ...row,
    tags: safeJson(row.tagsJson, []),
    semantic: safeJson(row.semanticJson, {}),
    embedding: safeJson(row.embeddingJson, [])
  };
}

function dedupeRows(rows: any[], key: string) {
  const byId = new Map<string, any>();
  for (const row of rows) {
    const rowKey = String(row?.[key] ?? "");
    if (!rowKey) {
      continue;
    }
    const existing = byId.get(rowKey);
    if (!existing) {
      byId.set(rowKey, row);
      continue;
    }
    byId.set(rowKey, mergeRankedRows(existing, row));
  }
  return [...byId.values()];
}

function mergeRankedRows(left: any, right: any) {
  return {
    ...left,
    ...right,
    tags: unique([...(left.tags ?? []), ...(right.tags ?? [])]).slice(0, 20),
    entities: unique([...(left.entities ?? []), ...(right.entities ?? [])]).slice(0, 12),
    semantic: {
      ...(left.semantic ?? {}),
      ...(right.semantic ?? {})
    },
    embedding: (right.embedding?.length ? right.embedding : left.embedding) ?? [],
    ftsRank: Math.min(Number(left.ftsRank ?? Infinity), Number(right.ftsRank ?? Infinity))
  };
}

function buildMemoryEmbedding({
  wing = "",
  hall = "",
  room = "",
  title = "",
  summary = "",
  detail = "",
  aaak = "",
  tags = [],
  entities = []
}: Record<string, any>) {
  return embedText(buildEmbeddingText({
    wing,
    hall,
    room,
    title,
    summary,
    detail,
    aaak,
    tags,
    entities
  }));
}

function buildEmbeddingText({
  wing = "",
  hall = "",
  room = "",
  title = "",
  summary = "",
  detail = "",
  aaak = "",
  tags = [],
  entities = []
}: Record<string, any>) {
  const semantic = semanticTerms([title, summary, detail, aaak, wing, hall, room].filter(Boolean).join(" "));
  return [
    title,
    summary,
    detail,
    aaak,
    wing,
    hall,
    room,
    normalizeStringArray(tags).join(" "),
    normalizeStringArray(entities).join(" "),
    semantic.join(" ")
  ].filter(Boolean).join("\n");
}

function buildSemanticSignature({
  wing = "",
  hall = "",
  room = "",
  title = "",
  summary = "",
  detail = "",
  aaak = "",
  tags = [],
  entities = []
}: Record<string, any>) {
  const weights = new Map<string, number>();
  addWeightedSemanticTerms(weights, title, 3);
  addWeightedSemanticTerms(weights, summary, 2.1);
  addWeightedSemanticTerms(weights, detail, 1.15);
  addWeightedSemanticTerms(weights, aaak, 1.1);
  addWeightedSemanticTerms(weights, `${wing} ${hall} ${room}`, 1.4);
  addWeightedSemanticTerms(weights, normalizeStringArray(tags).join(" "), 2.6);
  addWeightedSemanticTerms(weights, normalizeStringArray(entities).join(" "), 3.1);

  return Object.fromEntries(
    [...weights.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 64)
      .map(([term, weight]) => [term, Number(weight.toFixed(5))])
  );
}

function addWeightedSemanticTerms(weights: Map<string, number>, text: string, weight: number) {
  for (const term of semanticTerms(text)) {
    weights.set(term, (weights.get(term) ?? 0) + weight);
  }
}

function semanticTerms(text: string) {
  const baseTerms = extractFtsTerms(String(text ?? ""));
  const expanded = new Set<string>();
  for (const term of baseTerms) {
    expanded.add(term);
    expanded.add(term.replace(/s$/, ""));
    for (const synonym of SEMANTIC_SYNONYMS[term] ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded].filter((term) => term && term.length >= 2);
}

function signatureCosine(left: Record<string, number> = {}, right: Record<string, number> = {}) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (!leftKeys.length || !rightKeys.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const key of leftKeys) {
    const leftValue = Number(left[key] ?? 0);
    leftNorm += leftValue * leftValue;
    dot += leftValue * Number(right[key] ?? 0);
  }
  for (const key of rightKeys) {
    const rightValue = Number(right[key] ?? 0);
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function searchMemoryEntities(db: any, {
  query,
  repoId = null,
  limit = 8
}: Record<string, any>) {
  const signature = buildSemanticSignature({ title: query, detail: query });
  const rows = db.prepare(`
    SELECT entity_id AS entityId, canonical_name AS canonicalName, display_name AS displayName,
           entity_type AS entityType, aliases_json AS aliasesJson, properties_json AS propertiesJson
    FROM memory_entities
    ORDER BY updated_at DESC
  `).all();

  return rows.map((row: any) => {
    const aliases = safeJson(row.aliasesJson, []);
    const entitySignature = buildSemanticSignature({
      title: row.displayName,
      detail: aliases.join(" "),
      summary: JSON.stringify(safeJson(row.propertiesJson, {}))
    });
    const score = signatureCosine(signature, entitySignature) + entityExactMatchBoost(query, row.displayName, aliases);
    return {
      ...row,
      aliases,
      score,
      repoId
    };
  }).filter((row: any) => row.score > 0.08)
    .sort((left: any, right: any) => right.score - left.score)
    .slice(0, clampLimit(limit, 1, 20, 8));
}

function queryEntriesByEntityIds(db: any, {
  repoId = null,
  wing = null,
  hall = null,
  room = null,
  entityIds = [],
  limit = 16
}: Record<string, any>) {
  if (!entityIds?.length) {
    return [];
  }
  const clauses = [`l.entity_id IN (${entityIds.map(() => "?").join(", ")})`];
  const params: any[] = [...entityIds];
  if (repoId) {
    clauses.push("(e.repo_id = ? OR e.repo_id IS NULL)");
    params.push(repoId);
  }
  if (wing) {
    clauses.push("e.wing = ?");
    params.push(wing);
  }
  if (hall) {
    clauses.push("e.hall = ?");
    params.push(String(hall));
  }
  if (room) {
    clauses.push("e.room = ?");
    params.push(room);
  }
  return db.prepare(`
    SELECT DISTINCT e.entry_id AS entryId, e.scope, e.repo_id AS repoId, e.session_id AS sessionId, e.wing, e.hall, e.room,
           e.title, e.summary, e.detail, e.aaak, e.semantic_json AS semanticJson, e.embedding_json AS embeddingJson, e.tags_json AS tagsJson, e.importance,
           e.source_type AS sourceType, e.source_ref AS sourceRef, e.created_at AS createdAt, e.updated_at AS updatedAt,
           0.75 AS ftsRank
    FROM memory_entry_entities l
    JOIN memory_entries e ON e.entry_id = l.entry_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY e.importance DESC, e.updated_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 60, 16)).map((row: any) => hydrateMemoryEntry(db, row));
}

function queryFactsByEntityIds(db: any, {
  repoId = null,
  entityIds = [],
  asOf = null,
  limit = 12
}: Record<string, any>) {
  if (!entityIds?.length) {
    return [];
  }
  const clauses = [`(t.subject_entity_id IN (${entityIds.map(() => "?").join(", ")}) OR t.object_entity_id IN (${entityIds.map(() => "?").join(", ")}))`];
  const params: any[] = [...entityIds, ...entityIds];
  if (repoId) {
    clauses.push("(t.repo_id = ? OR t.repo_id IS NULL)");
    params.push(repoId);
  }
  if (asOf) {
    clauses.push("(t.valid_from IS NULL OR t.valid_from <= ?)");
    clauses.push("(t.valid_to IS NULL OR t.valid_to >= ?)");
    params.push(asOf, asOf);
  }
  return annotateFactConflicts(db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
           t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    WHERE ${clauses.join(" AND ")}
    ORDER BY t.confidence DESC, t.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 40, 12)).map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate: row.predicate,
    object: row.objectName,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    sourceKind: row.sourceKind,
    sourceEntryId: row.sourceEntryId,
    metadata: safeJson(row.metadataJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    createdAt: row.createdAt,
    current: row.validTo == null
  })));
}

function listSemanticMemoryEntries(db: any, {
  repoId = null,
  wing = null,
  hall = null,
  room = null,
  limit = 48
}: Record<string, any>) {
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(repo_id = ? OR repo_id IS NULL)");
    params.push(repoId);
  }
  if (wing) {
    clauses.push("wing = ?");
    params.push(wing);
  }
  if (hall) {
    clauses.push("hall = ?");
    params.push(String(hall));
  }
  if (room) {
    clauses.push("room = ?");
    params.push(room);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT entry_id AS entryId, scope, repo_id AS repoId, session_id AS sessionId, wing, hall, room, title,
           summary, detail, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson, importance,
           source_type AS sourceType, source_ref AS sourceRef, created_at AS createdAt, updated_at AS updatedAt,
           1 AS ftsRank
    FROM memory_entries
    ${whereSql}
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 120, 48)).map((row: any) => hydrateMemoryEntry(db, row));
}

function listSemanticDiaryEntries(db: any, {
  repoId = null,
  limit = 24
}: Record<string, any>) {
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(repo_id = ? OR repo_id IS NULL)");
    params.push(repoId);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT diary_id AS diaryId, agent_id AS agentId, repo_id AS repoId, session_id AS sessionId,
           title, entry_text AS entryText, aaak, semantic_json AS semanticJson, embedding_json AS embeddingJson, tags_json AS tagsJson,
           created_at AS createdAt, 1 AS ftsRank
    FROM memory_diaries
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 80, 24)).map((row: any) => ({
    ...row,
    tags: safeJson(row.tagsJson, []),
    semantic: safeJson(row.semanticJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    ftsRank: Number(row.ftsRank ?? 1)
  }));
}

function listSemanticFacts(db: any, {
  repoId = null,
  asOf = null,
  limit = 32
}: Record<string, any>) {
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(t.repo_id = ? OR t.repo_id IS NULL)");
    params.push(repoId);
  }
  if (asOf) {
    clauses.push("(t.valid_from IS NULL OR t.valid_from <= ?)");
    clauses.push("(t.valid_to IS NULL OR t.valid_to >= ?)");
    params.push(asOf, asOf);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return annotateFactConflicts(db.prepare(`
    SELECT t.triple_id AS tripleId, t.predicate, t.valid_from AS validFrom, t.valid_to AS validTo,
           t.confidence, t.created_at AS createdAt, t.source_kind AS sourceKind, t.source_entry_id AS sourceEntryId,
           t.metadata_json AS metadataJson, t.embedding_json AS embeddingJson, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    ${whereSql}
    ORDER BY t.confidence DESC, t.created_at DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 100, 32)).map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate: row.predicate,
    object: row.objectName,
    validFrom: row.validFrom,
    validTo: row.validTo,
    confidence: row.confidence,
    sourceKind: row.sourceKind,
    sourceEntryId: row.sourceEntryId,
    metadata: safeJson(row.metadataJson, {}),
    embedding: safeJson(row.embeddingJson, []),
    createdAt: row.createdAt,
    current: row.validTo == null
  })));
}

function groupedEntryTopology(db: any, {
  repoId = null,
  wing = null,
  hall = null,
  by = "wing",
  limit = 8
}: Record<string, any>) {
  const column = by === "hall" ? "hall" : by === "room" ? "room" : "wing";
  const clauses = [];
  const params: any[] = [];
  if (repoId) {
    clauses.push("(repo_id = ? OR repo_id IS NULL)");
    params.push(repoId);
  }
  if (wing) {
    clauses.push("wing = ?");
    params.push(wing);
  }
  if (hall) {
    clauses.push("hall = ?");
    params.push(String(hall));
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`
    SELECT ${column} AS label, COUNT(*) AS count, MAX(updated_at) AS updatedAt
    FROM memory_entries
    ${whereSql}
    GROUP BY ${column}
    ORDER BY count DESC, updatedAt DESC
    LIMIT ?
  `).all(...params, clampLimit(limit, 1, 30, 8)).map((row: any) => ({
    [column]: row.label,
    count: row.count,
    updatedAt: row.updatedAt
  }));
}

function buildNavigationSummary({
  normalizedWing,
  hall,
  normalizedRoom,
  wings,
  halls,
  rooms,
  entryCount
}: Record<string, any>) {
  if (normalizedWing && hall && normalizedRoom) {
    return `Navigated memory room ${normalizedWing}/${hall}/${normalizedRoom} with ${entryCount} recent entr${entryCount === 1 ? "y" : "ies"}.`;
  }
  if (normalizedWing && hall) {
    return `Navigated hall ${normalizedWing}/${hall} with ${rooms.length} room${rooms.length === 1 ? "" : "s"} and ${entryCount} recent entr${entryCount === 1 ? "y" : "ies"}.`;
  }
  if (normalizedWing) {
    return `Navigated wing ${normalizedWing} with ${halls.length} hall${halls.length === 1 ? "" : "s"}.`;
  }
  return `Mapped ${wings.length} memory wing${wings.length === 1 ? "" : "s"} across durable memory.`;
}

function normalizeEmbedding(value: any) {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item ?? 0));
  }
  return [];
}

function entryMemoryProvenanceScore(entry: any) {
  const sourceWeight = {
    manual: 0.96,
    import: 0.9,
    bridge: 0.84,
    session_autosave: 0.7,
    diary: 0.68,
    inferred: 0.48,
    derived: 0.42
  }[String(entry.sourceType ?? "manual")] ?? 0.58;
  let score = sourceWeight;
  if (entry.sourceRef) score += 0.04;
  if (entry.scope === "global") score += 0.02;
  if (["facts", "discoveries", "preferences"].includes(String(entry.hall ?? ""))) score += 0.03;
  return clampImportance(score);
}

function diaryMemoryProvenanceScore(diary: any) {
  let score = diary.agentId === "claude" ? 0.74 : 0.64;
  if (diary.repoId) score += 0.04;
  if (diary.sessionId) score += 0.03;
  if ((diary.tags ?? []).some((tag: any) => /checkpoint|decision|summary/i.test(String(tag)))) score += 0.04;
  return clampImportance(score);
}

function factMemoryProvenanceScore(fact: any) {
  const sourceWeight = {
    manual: 0.96,
    verified: 0.94,
    import: 0.88,
    session_autosave: 0.68,
    inferred: 0.45,
    derived: 0.4
  }[String(fact.sourceKind ?? "manual")] ?? 0.6;
  let score = sourceWeight + (Number(fact.confidence ?? 0.5) * 0.08);
  if (fact.sourceEntryId) score += 0.04;
  if (fact.current) score += 0.05;
  if (fact.metadata?.verified === true) score += 0.08;
  return clampImportance(score);
}

function entityAssociationScore(entryEntities: any[] = [], matchedEntities: any[] = []) {
  if (!entryEntities?.length || !matchedEntities?.length) {
    return 0;
  }
  const matched = new Set(matchedEntities.map((entity: any) => slugify(entity.displayName, "")));
  const hits = entryEntities
    .map((entity) => slugify(entity, ""))
    .filter((entity) => matched.has(entity)).length;
  return hits ? Math.min(1, hits / Math.max(1, matched.size)) : 0;
}

function factEntityScore(fact: any, matchedEntities: any[] = []) {
  if (!matchedEntities?.length) {
    return 0;
  }
  const matched = new Set(matchedEntities.map((entity: any) => slugify(entity.displayName, "")));
  const hits = [fact.subject, fact.object].map((value) => slugify(value, "")).filter((value) => matched.has(value)).length;
  return hits ? Math.min(1, hits / 2) : 0;
}

function topologyScore(candidate: any, {
  wing = null,
  hall = null,
  room = null
}: Record<string, any>) {
  let score = 0;
  if (wing && candidate.wing === wing) {
    score += 0.45;
  }
  if (hall && candidate.hall === hall) {
    score += 0.35;
  }
  if (room && candidate.room === room) {
    score += 0.35;
  }
  return Math.min(1, score);
}

function factContradictionPenalty(fact: any) {
  if (!fact.current) {
    return 0.1;
  }
  return fact.conflicted ? 0.18 : 0;
}

function annotateFactConflicts(facts: any[]) {
  const groups = new Map<string, any[]>();
  for (const fact of facts) {
    const key = `${fact.subject}::${fact.predicate}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(fact);
    groups.set(key, bucket);
  }
  return facts.map((fact) => {
    const bucket = groups.get(`${fact.subject}::${fact.predicate}`) ?? [];
    const conflicted = shouldTreatPredicateAsExclusive(fact.predicate)
      && bucket.filter((entry) => entry.current && entry.object !== fact.object).length > 0;
    return {
      ...fact,
      conflicted
    };
  });
}

function entityExactMatchBoost(query: string, displayName: string, aliases: any[] = []) {
  const normalizedQuery = slugify(query, "");
  const candidates = [displayName, ...aliases].map((value) => slugify(value, ""));
  if (candidates.includes(normalizedQuery)) {
    return 0.65;
  }
  if (candidates.some((candidate) => candidate && normalizedQuery.includes(candidate))) {
    return 0.22;
  }
  return 0;
}

function shouldInvalidateFactConflicts(predicate: string, metadata: Record<string, any> = {}, strategy: any = "auto") {
  if (strategy === false || strategy === "never") {
    return false;
  }
  if (strategy === true || strategy === "always") {
    return true;
  }
  if (metadata?.multiValued === true) {
    return false;
  }
  if (metadata?.exclusive === true) {
    return true;
  }
  return shouldTreatPredicateAsExclusive(predicate);
}

function shouldTreatPredicateAsExclusive(predicate: string) {
  const normalized = String(predicate ?? "").trim();
  if (!normalized) {
    return false;
  }
  if (NON_EXCLUSIVE_PREDICATES.has(normalized)) {
    return false;
  }
  return EXCLUSIVE_PREDICATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function invalidateConflictingFacts(db: any, {
  subjectEntityId,
  predicate,
  objectEntityId,
  ended
}: Record<string, any>) {
  const rows = db.prepare(`
    SELECT t.triple_id AS tripleId, s.display_name AS subjectName, o.display_name AS objectName
    FROM memory_triples t
    JOIN memory_entities s ON s.entity_id = t.subject_entity_id
    JOIN memory_entities o ON o.entity_id = t.object_entity_id
    WHERE t.subject_entity_id = ?
      AND t.predicate = ?
      AND t.object_entity_id != ?
      AND t.valid_to IS NULL
  `).all(subjectEntityId, predicate, objectEntityId);
  if (!rows.length) {
    return [];
  }
  db.prepare(`
    UPDATE memory_triples
    SET valid_to = ?, updated_at = ?
    WHERE subject_entity_id = ?
      AND predicate = ?
      AND object_entity_id != ?
      AND valid_to IS NULL
  `).run(ended, Date.now(), subjectEntityId, predicate, objectEntityId);
  return rows.map((row: any) => ({
    tripleId: row.tripleId,
    subject: row.subjectName,
    predicate,
    object: row.objectName,
    ended
  }));
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
