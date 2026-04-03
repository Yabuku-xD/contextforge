export function bm25Search(db, query, limit = 10) {
  return db.prepare(`
    SELECT chunk_id AS id, label, text, bm25(chunk_fts) AS score
    FROM chunk_fts
    WHERE chunk_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(query, limit).map((row) => ({
    id: row.id,
    label: row.label,
    text: row.text,
    score: 1 / (Math.abs(row.score) + 1)
  }));
}
