import { makeId } from "../indexing/canonicalize.js";
import { clip, estimateTokens, tokenize, unique } from "../utils/text.js";

const DEFAULT_SECTION_CHARS = 4000;

export function chunkResearchText(text, { maxChars = DEFAULT_SECTION_CHARS } = {}) {
  const normalized = String(text ?? "");
  if (!normalized.length) {
    return [];
  }

  const lines = normalized.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let current = [];
  let currentLength = 0;

  for (const line of lines) {
    const candidateLength = currentLength + line.length + 1;
    if (current.length && candidateLength > maxChars) {
      sections.push(current.join("\n"));
      current = [line];
      currentLength = line.length + 1;
      continue;
    }

    current.push(line);
    currentLength = candidateLength;
  }

  if (current.length) {
    sections.push(current.join("\n"));
  }

  return sections.filter(Boolean);
}

export function storeResearchSource(db, {
  repoId,
  sessionId,
  label,
  sourceType = "batch",
  metadata = {},
  sections = []
}) {
  const sourceId = makeId("research", `${repoId}:${sessionId ?? "shared"}:${Date.now()}:${label}`);
  const createdAt = Date.now();
  db.prepare(`
    INSERT OR REPLACE INTO research_sources (source_id, repo_id, session_id, source_type, label, metadata_json, created_at)
    VALUES (@sourceId, @repoId, @sessionId, @sourceType, @label, @metadataJson, @createdAt)
  `).run({
    sourceId,
    repoId,
    sessionId: sessionId ?? null,
    sourceType,
    label,
    metadataJson: JSON.stringify(metadata),
    createdAt
  });

  const insertSection = db.prepare(`
    INSERT OR REPLACE INTO research_sections (section_id, source_id, repo_id, title, text, section_order, token_estimate)
    VALUES (@sectionId, @sourceId, @repoId, @title, @text, @sectionOrder, @tokenEstimate)
  `);
  const insertFts = db.prepare(`
    INSERT INTO research_fts (section_id, title, text)
    VALUES (?, ?, ?)
  `);

  for (const [index, section] of sections.entries()) {
    const title = section.title ?? `${label} section ${index + 1}`;
    const text = String(section.text ?? "");
    const sectionId = makeId("research_section", `${sourceId}:${index}:${title}`);
    insertSection.run({
      sectionId,
      sourceId,
      repoId,
      title,
      text,
      sectionOrder: index,
      tokenEstimate: estimateTokens(text)
    });
    insertFts.run(sectionId, title, text);
  }

  return {
    sourceId,
    label,
    sourceType,
    sectionsIndexed: sections.length,
    createdAt
  };
}

export function searchResearchSections(db, {
  repoId,
  queries,
  sourceId = null,
  limit = 3
}) {
  const normalizedQueries = normalizeQueries(queries);
  return normalizedQueries.map((query) => ({
    query,
    matches: searchOneResearchQuery(db, {
      repoId,
      query,
      sourceId,
      limit
    })
  }));
}

function searchOneResearchQuery(db, { repoId, query, sourceId, limit }) {
  const tokens = unique(tokenize(query)).slice(0, 8);
  if (!tokens.length) {
    return [];
  }

  const matchQuery = tokens.map((token) => `${token}*`).join(" OR ");
  const rows = db.prepare(`
    SELECT
      research_fts.section_id AS sectionId,
      research_sections.source_id AS sourceId,
      research_sections.title AS title,
      research_sections.text AS text,
      research_sources.label AS label,
      research_sources.source_type AS sourceType,
      bm25(research_fts) AS rank
    FROM research_fts
    JOIN research_sections
      ON research_sections.section_id = research_fts.section_id
    JOIN research_sources
      ON research_sources.source_id = research_sections.source_id
    WHERE research_sections.repo_id = ?
      ${sourceId ? "AND research_sections.source_id = ?" : ""}
      AND research_fts MATCH ?
    ORDER BY rank ASC, research_sections.section_order ASC
    LIMIT ?
  `).all(...(sourceId ? [repoId, sourceId, matchQuery, limit] : [repoId, matchQuery, limit]));

  return rows.map((row) => ({
    sourceId: row.sourceId,
    label: row.label,
    sourceType: row.sourceType,
    title: row.title,
    preview: clip(row.text.replace(/\s+/g, " ").trim(), 280),
    score: Number((1 / (1 + Math.max(0, row.rank ?? 0))).toFixed(3))
  }));
}

function normalizeQueries(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  }

  const single = String(value ?? "").trim();
  return single ? [single] : [];
}
