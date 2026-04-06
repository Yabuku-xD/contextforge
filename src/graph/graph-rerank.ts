import { personalizedPageRank } from "./pagerank.js";
import { resolveAliasSeeds } from "./alias-resolution.js";
import { tokenize } from "../utils/text.js";

export function rerankWithGraph({ query, results, repoGraph, symbols }) {
  const seeds = resolveAliasSeeds(query, symbols, 6);
  if (!seeds.length) {
    return results;
  }

  const ranked = personalizedPageRank({
    nodes: repoGraph.nodes,
    edges: repoGraph.edges,
    seeds
  });
  const scores = new Map(ranked.map((entry) => [entry.id, entry.score]));

  return results
    .map((result) => {
      const graphScore = scores.get(result.symbolId ?? result.id) ?? scores.get(result.fileId) ?? 0;
      const lexicalScore = lexicalOverlap(result.label ?? "", query);
      return {
        ...result,
        graphScore,
        lexicalScore,
        finalScore: (result.score ?? 0) + lexicalScore * 0.35 + graphScore * 0.15
      };
    })
    .sort((left, right) => right.finalScore - left.finalScore);
}

function lexicalOverlap(label, query) {
  const labelTokens = new Set(tokenize(label));
  const queryTokens = tokenize(query);
  let matches = 0;
  for (const token of queryTokens) {
    if (labelTokens.has(token) || [...labelTokens].some((labelToken) => labelToken.includes(token) || token.includes(labelToken))) {
      matches += 1;
    }
  }
  return queryTokens.length ? matches / queryTokens.length : 0;
}
