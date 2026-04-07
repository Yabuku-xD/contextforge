import { makeId } from "../indexing/canonicalize.js";
import { parseImports } from "./import-specifiers.js";

const CALL_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
const IGNORED_CALLS = new Set([
  "catch",
  "for",
  "function",
  "if",
  "Promise",
  "return",
  "setTimeout",
  "switch",
  "while"
]);

export function extractCallEdges({ repoId, symbols, files = [] }): any[] {
  const symbolsByName = new Map();
  const importAliasesByFile = new Map();

  for (const file of files) {
    const aliases = new Map();
    for (const spec of parseImports(file.content)) {
      aliases.set(spec.localName, spec.importedName === "*" ? spec.localName : spec.importedName);
    }
    importAliasesByFile.set(file.fileId, aliases);
  }

  for (const symbol of symbols) {
    for (const name of new Set([symbol.displayName, symbol.canonicalName.split("::").pop()])) {
      if (!symbolsByName.has(name)) {
        symbolsByName.set(name, []);
      }

      symbolsByName.get(name).push(symbol);
    }
  }

  const edges = [];
  for (const symbol of symbols) {
    const aliases = importAliasesByFile.get(symbol.fileId) ?? new Map();
    for (const match of symbol.body.matchAll(CALL_RE)) {
      const rawName = match[1];
      if (IGNORED_CALLS.has(rawName) || rawName === symbol.displayName) {
        continue;
      }

      const calleeName = aliases.get(rawName) ?? rawName;
      const targets = symbolsByName.get(calleeName) ?? symbolsByName.get(rawName) ?? [];
      for (const target of targets) {
        if (target.symbolId === symbol.symbolId) {
          continue;
        }

        edges.push({
          edgeId: makeId("edge", `${symbol.symbolId}:call:${target.symbolId}:${rawName}`),
          repoId,
          fromSymbolId: symbol.symbolId,
          toSymbolId: target.symbolId,
          edgeType: "call",
          confidence: target.fileId === symbol.fileId ? 0.92 : aliases.has(rawName) ? 0.88 : 0.72,
          provenanceSource: aliases.has(rawName) ? `import_alias:${rawName}->${calleeName}` : "regex_call"
        });
      }
    }
  }

  return dedupeEdges(edges);
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    if (seen.has(edge.edgeId)) {
      return false;
    }

    seen.add(edge.edgeId);
    return true;
  });
}
