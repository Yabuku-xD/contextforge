export function personalizedPageRank({ nodes, edges, seeds, alpha = 0.15, iterations = 20 }) {
  const nodeIds = nodes.map((node) => node.id);
  const out = new Map(nodeIds.map((id) => [id, []]));
  const seedSet = new Set(seeds);

  for (const edge of edges) {
    if (!out.has(edge.fromSymbolId)) {
      out.set(edge.fromSymbolId, []);
    }
    out.get(edge.fromSymbolId).push({ to: edge.toSymbolId, weight: edge.confidence ?? 1 });
  }

  let scores = new Map(nodeIds.map((id) => [id, seedSet.has(id) ? 1 / Math.max(seedSet.size, 1) : 0]));
  for (let i = 0; i < iterations; i += 1) {
    const next = new Map(nodeIds.map((id) => [id, alpha * (seedSet.has(id) ? 1 / Math.max(seedSet.size, 1) : 0)]));
    for (const id of nodeIds) {
      const outgoing = out.get(id) ?? [];
      if (!outgoing.length) {
        continue;
      }

      const currentScore = scores.get(id) ?? 0;
      const totalWeight = outgoing.reduce((sum, edge) => sum + edge.weight, 0);
      for (const edge of outgoing) {
        next.set(edge.to, (next.get(edge.to) ?? 0) + (1 - alpha) * currentScore * (edge.weight / totalWeight));
      }
    }
    scores = next;
  }

  return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}
