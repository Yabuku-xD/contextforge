import { makeId } from "../indexing/canonicalize.js";

const ASSIGN_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
const IGNORED = new Set(["if", "for", "while", "return"]);

export function extractDataFlowEdges({ repoId, symbols }): any[] {
  const edges = [];
  const producersByName = new Map();

  for (const symbol of symbols) {
    for (const match of [...symbol.body.matchAll(ASSIGN_RE), ...symbol.body.matchAll(DECL_RE)]) {
      const name = match[1];
      if (IGNORED.has(name)) {
        continue;
      }

      if (!producersByName.has(name)) {
        producersByName.set(name, []);
      }
      producersByName.get(name).push(symbol);
    }
  }

  for (const symbol of symbols) {
    for (const [name, producers] of producersByName.entries()) {
      if (!new RegExp(`\\b${name}\\b`).test(symbol.body) || producers.some((producer) => producer.symbolId === symbol.symbolId)) {
        continue;
      }

      for (const producer of producers) {
        edges.push({
          edgeId: makeId("edge", `${producer.symbolId}:data:${symbol.symbolId}:${name}`),
          repoId,
          fromSymbolId: producer.symbolId,
          toSymbolId: symbol.symbolId,
          edgeType: "data",
          confidence: producer.fileId === symbol.fileId ? 0.65 : 0.35,
          provenanceSource: `identifier:${name}`
        });
      }
    }
  }

  return edges;
}
