import { tokenize } from "../utils/text.js";

export function bm25Search(db, query, limit = 10): any[] {
  const matchQuery = toFtsMatchQuery(query);
  if (!matchQuery) {
    return [];
  }

  return db.prepare(`
    SELECT chunk_id AS id, label, text, bm25(chunk_fts) AS score
    FROM chunk_fts
    WHERE chunk_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(matchQuery, limit).map((row) => ({
    id: row.id,
    label: row.label,
    text: row.text,
    score: 1 / (Math.abs(row.score) + 1)
  }));
}

function toFtsMatchQuery(query) {
  const terms = tokenize(query)
    .filter((term) => term.length > 1 || /^\d+$/.test(term))
    .slice(0, 16);

  if (!terms.length) {
    return null;
  }

  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" OR ");
}
