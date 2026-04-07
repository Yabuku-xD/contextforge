import { MODEL_METADATA } from "../storage/model-metadata.js";
import { tokenize, cosineSimilarity } from "../utils/text.js";

export function embedText(text, dimension = MODEL_METADATA.embeddings.default.dimension): number[] {
  const vector = new Float32Array(dimension);
  const tokens = tokenize(text);

  for (const token of tokens) {
    const index = hashToken(token) % dimension;
    vector[index] += 1;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) {
    return Array.from(vector);
  }

  return Array.from(vector, (value) => value / norm);
}

export function vectorSearch(query, items, limit = 10): any[] {
  const queryVector = embedText(query);
  return items
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryVector, item.embedding)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0);
}
