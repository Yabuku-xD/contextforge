export function fallbackImpact(seedSymbolId, edges, depth = 3): string[] {
  const queue = [{ id: seedSymbolId, depth: 0 }];
  const seen = new Set([seedSymbolId]);

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= depth) {
      continue;
    }

    for (const edge of edges) {
      if (edge.fromSymbolId !== current.id || seen.has(edge.toSymbolId)) {
        continue;
      }

      seen.add(edge.toSymbolId);
      queue.push({ id: edge.toSymbolId, depth: current.depth + 1 });
    }
  }

  return [...seen];
}
