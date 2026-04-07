import { makeId } from "../indexing/canonicalize.js";

const CONTROL_RE = /\bif\s*\((.+?)\)/g;

export function extractControlEdges({ repoId, symbols }): any[] {
  const edges = [];
  for (const symbol of symbols) {
    let index = 0;
    for (const match of symbol.body.matchAll(CONTROL_RE)) {
      edges.push({
        edgeId: makeId("edge", `${symbol.symbolId}:control:${index}`),
        repoId,
        fromSymbolId: symbol.symbolId,
        toSymbolId: symbol.symbolId,
        edgeType: "control",
        confidence: 0.5,
        provenanceSource: `guard:${match[1].slice(0, 80)}`
      });
      index += 1;
    }
  }

  return edges;
}
