import { makeId } from "../indexing/canonicalize.js";
import { parseImports, resolveImportTargetFile } from "./import-specifiers.js";

export function extractImportEdges({ repoId, symbols, files }: { repoId: string; symbols: any[]; files: any[] }) {
  const symbolByFile = new Map<string, any[]>();

  for (const symbol of symbols) {
    if (!symbolByFile.has(symbol.fileId)) {
      symbolByFile.set(symbol.fileId, []);
    }

    symbolByFile.get(symbol.fileId)?.push(symbol);
  }

  const edges: any[] = [];
  for (const file of files) {
    const importers = symbolByFile.get(file.fileId) ?? [];
    if (!importers.length) {
      continue;
    }

    for (const spec of parseImports(file.content)) {
      const targetFile: any = resolveImportTargetFile(file.relativePath, spec.sourcePath, files);
      if (!targetFile) {
        continue;
      }

      const targetSymbols = symbolByFile.get(targetFile.fileId) ?? [];
      if (!targetSymbols.length) {
        continue;
      }

      const matchedTargets = spec.importedName === "*"
        ? targetSymbols
        : targetSymbols.filter((symbol) => symbol.displayName === spec.importedName);
      const resolvedTargets = matchedTargets.length ? matchedTargets : targetSymbols.slice(0, 1);

      for (const importer of importers) {
        for (const target of resolvedTargets) {
          edges.push({
            edgeId: makeId("edge", `${importer.symbolId}:import:${target.symbolId}:${spec.localName}`),
            repoId,
            fromSymbolId: importer.symbolId,
            toSymbolId: target.symbolId,
            edgeType: "import",
            confidence: matchedTargets.length ? 0.9 : 0.65,
            provenanceSource: `import:${spec.localName}->${spec.importedName}@${targetFile.relativePath}`
          });
        }
      }
    }
  }

  return dedupe(edges);
}

function dedupe(edges) {
  const seen = new Set();
  return edges.filter((edge) => {
    if (seen.has(edge.edgeId)) {
      return false;
    }

    seen.add(edge.edgeId);
    return true;
  });
}
