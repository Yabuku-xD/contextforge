export function exactSymbolSearch(query, symbols, limit = 10): any[] {
  const lowered = String(query ?? "").toLowerCase();
  return symbols
    .map((symbol) => {
      let score = 0;
      if (symbol.displayName.toLowerCase() === lowered) score += 1;
      if (symbol.canonicalName.toLowerCase() === lowered) score += 1;
      if (symbol.displayName.toLowerCase().includes(lowered)) score += 0.6;
      if (symbol.canonicalName.toLowerCase().includes(lowered)) score += 0.4;
      return { ...symbol, score };
    })
    .filter((symbol) => symbol.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
