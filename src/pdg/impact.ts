const IMPACT_EDGE_TYPES = new Set(["call", "control", "data", "import"]);

export function computeImpact(seedSymbolId: string, allEdges: any[], options: Record<string, any> = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const minScore = options.minScore ?? 0.18;
  const relevant = allEdges.filter((edge) => IMPACT_EDGE_TYPES.has(edge.edgeType));
  const adjacency = new Map();

  for (const edge of relevant) {
    pushEdge(adjacency, edge.fromSymbolId, edge.toSymbolId, edge.confidence ?? 0.5);
    pushEdge(adjacency, edge.toSymbolId, edge.fromSymbolId, (edge.confidence ?? 0.5) * reversePenalty(edge.edgeType));
  }

  const queue = [{ id: seedSymbolId, depth: 0, score: 1 }];
  const best = new Map([[seedSymbolId, 1]]);

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) {
      continue;
    }

    for (const edge of adjacency.get(current.id) ?? []) {
      const nextScore = current.score * edge.weight;
      if (nextScore < minScore && edge.to !== seedSymbolId) {
        continue;
      }

      if ((best.get(edge.to) ?? 0) >= nextScore) {
        continue;
      }

      best.set(edge.to, nextScore);
      queue.push({
        id: edge.to,
        depth: current.depth + 1,
        score: nextScore
      });
    }
  }

  return [...best.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([symbolId]) => symbolId);
}

function pushEdge(adjacency: Map<string, any[]>, from: string, to: string, weight: number) {
  if (!adjacency.has(from)) {
    adjacency.set(from, []);
  }

  adjacency.get(from).push({ to, weight });
}

function reversePenalty(edgeType: string) {
  if (edgeType === "control") return 0.55;
  if (edgeType === "data") return 0.75;
  return 0.85;
}
