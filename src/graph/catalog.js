import path from "node:path";
import { unique } from "../utils/text.js";

const FLOW_EDGE_TYPES = new Set(["call", "control", "data", "import"]);

export function buildAreaCatalog({
  topLevel = [],
  packages = [],
  files = [],
  symbols = [],
  edges = [],
  entrypoints = []
}) {
  const symbolCountByFile = new Map();
  const edgeCountByFile = new Map();

  for (const symbol of symbols) {
    symbolCountByFile.set(symbol.fileId, (symbolCountByFile.get(symbol.fileId) ?? 0) + 1);
  }

  const symbolToFile = new Map(symbols.map((symbol) => [symbol.symbolId, symbol.fileId]));
  for (const edge of edges) {
    const fromFileId = symbolToFile.get(edge.fromSymbolId);
    const toFileId = symbolToFile.get(edge.toSymbolId);
    if (fromFileId) edgeCountByFile.set(fromFileId, (edgeCountByFile.get(fromFileId) ?? 0) + 1);
    if (toFileId) edgeCountByFile.set(toFileId, (edgeCountByFile.get(toFileId) ?? 0) + 1);
  }

  const scopeDefs = packages.length
    ? packages.map((pkg) => ({
        id: `package:${pkg.path}`,
        path: pkg.path,
        label: pkg.name ?? pkg.path,
        description: pkg.description ?? null,
        type: "package"
      }))
    : topLevel
        .filter((item) => item.path !== ".")
        .map((item) => ({
          id: `directory:${item.path}`,
          path: item.path,
          label: item.path,
          description: null,
          type: "directory"
        }));

  return scopeDefs
    .map((scope) => {
      const scopedFiles = files.filter((file) => file.relativePath === scope.path || file.relativePath.startsWith(`${scope.path}/`));
      const scopedFileIds = new Set(scopedFiles.map((file) => file.fileId));
      const scopedSymbols = symbols.filter((symbol) => scopedFileIds.has(symbol.fileId));
      const scopedEntrypoints = entrypoints.filter((entry) => entry.path === scope.path || entry.path.startsWith(`${scope.path}/`)).slice(0, 6);
      const languages = unique(scopedFiles.map((file) => file.language).filter(Boolean)).sort();
      const score = scopedFiles.reduce((sum, file) => sum + (symbolCountByFile.get(file.fileId) ?? 0) + (edgeCountByFile.get(file.fileId) ?? 0), 0);
      const dominantFiles = scopedFiles
        .map((file) => ({
          path: file.relativePath,
          score: (symbolCountByFile.get(file.fileId) ?? 0) + (edgeCountByFile.get(file.fileId) ?? 0),
          symbols: symbolCountByFile.get(file.fileId) ?? 0,
          edges: edgeCountByFile.get(file.fileId) ?? 0
        }))
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, 5);

      return {
        id: scope.id,
        label: scope.label,
        path: scope.path,
        type: scope.type,
        description: scope.description,
        fileCount: scopedFiles.length,
        symbolCount: scopedSymbols.length,
        entrypointCount: scopedEntrypoints.length,
        languages,
        dominantFiles,
        entrypoints: scopedEntrypoints,
        summary: buildAreaSummary({
          label: scope.label,
          path: scope.path,
          type: scope.type,
          fileCount: scopedFiles.length,
          symbolCount: scopedSymbols.length,
          entrypoints: scopedEntrypoints,
          languages
        }),
        score
      };
    })
    .sort((left, right) => right.fileCount - left.fileCount || right.score - left.score || left.path.localeCompare(right.path));
}

export function buildFlowCatalog({
  files = [],
  symbols = [],
  edges = [],
  entrypoints = []
}) {
  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
  const symbolsByFileId = new Map();
  const symbolById = new Map(symbols.map((symbol) => [symbol.symbolId, symbol]));
  const adjacency = new Map();
  const fileScores = new Map();

  for (const symbol of symbols) {
    if (!symbolsByFileId.has(symbol.fileId)) {
      symbolsByFileId.set(symbol.fileId, []);
    }
    symbolsByFileId.get(symbol.fileId).push(symbol);
    fileScores.set(symbol.fileId, (fileScores.get(symbol.fileId) ?? 0) + 2);
  }

  for (const edge of edges) {
    if (!FLOW_EDGE_TYPES.has(edge.edgeType)) {
      continue;
    }
    if (!adjacency.has(edge.fromSymbolId)) {
      adjacency.set(edge.fromSymbolId, []);
    }
    adjacency.get(edge.fromSymbolId).push(edge.toSymbolId);
    const fromSymbol = symbolById.get(edge.fromSymbolId);
    const toSymbol = symbolById.get(edge.toSymbolId);
    if (fromSymbol) fileScores.set(fromSymbol.fileId, (fileScores.get(fromSymbol.fileId) ?? 0) + 1);
    if (toSymbol) fileScores.set(toSymbol.fileId, (fileScores.get(toSymbol.fileId) ?? 0) + 1);
  }

  const candidateEntrypoints = entrypoints.length
    ? entrypoints
    : files
        .filter((file) => (symbolsByFileId.get(file.fileId) ?? []).length > 0)
        .map((file) => ({
          path: file.relativePath,
          reason: "graph_surface_fallback",
          score: fileScores.get(file.fileId) ?? 0
        }))
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
        .slice(0, 12);

  return candidateEntrypoints
    .slice(0, 12)
    .map((entry) => {
      const file = fileByPath.get(entry.path);
      const seedSymbols = file ? (symbolsByFileId.get(file.fileId) ?? []) : [];
      const visited = new Set(seedSymbols.map((symbol) => symbol.symbolId));
      const queue = seedSymbols.map((symbol) => ({ id: symbol.symbolId, depth: 0 }));

      while (queue.length) {
        const current = queue.shift();
        if (current.depth >= 4) {
          continue;
        }
        for (const nextId of adjacency.get(current.id) ?? []) {
          if (visited.has(nextId)) {
            continue;
          }
          visited.add(nextId);
          queue.push({ id: nextId, depth: current.depth + 1 });
        }
      }

      const touchedSymbols = [...visited]
        .map((symbolId) => symbolById.get(symbolId))
        .filter(Boolean);
      const touchedFiles = unique([
        entry.path,
        ...touchedSymbols
          .map((symbol) => files.find((fileItem) => fileItem.fileId === symbol.fileId)?.relativePath)
          .filter(Boolean)
      ]).sort();
      const modules = unique(touchedFiles.map((relativePath) => path.dirname(relativePath) || ".")).sort();
      const primarySymbol = seedSymbols[0] ?? touchedSymbols[0] ?? null;

      return {
        id: `flow:${entry.path}`,
        label: primarySymbol?.displayName ?? path.basename(entry.path),
        entrypoint: entry,
        seedSymbolCount: seedSymbols.length,
        symbolCount: touchedSymbols.length,
        fileCount: touchedFiles.length,
        moduleCount: modules.length,
        files: touchedFiles.slice(0, 12),
        modules: modules.slice(0, 10),
        summary: buildFlowSummary({
          entryPath: entry.path,
          label: primarySymbol?.displayName ?? path.basename(entry.path),
          symbolCount: touchedSymbols.length,
          fileCount: touchedFiles.length,
          moduleCount: modules.length,
          topFiles: touchedFiles.slice(0, 4)
        })
      };
    })
    .sort((left, right) => right.symbolCount - left.symbolCount || right.fileCount - left.fileCount || left.entrypoint.path.localeCompare(right.entrypoint.path));
}

export function buildGraphSchemaSummary({
  files = [],
  symbols = [],
  edges = [],
  areas = [],
  flows = []
}) {
  const edgeTypeCounts = new Map();
  for (const edge of edges) {
    edgeTypeCounts.set(edge.edgeType, (edgeTypeCounts.get(edge.edgeType) ?? 0) + 1);
  }

  const nodeTypeCounts = [
    { type: "file", count: files.length },
    { type: "symbol", count: symbols.length },
    { type: "area", count: areas.length },
    { type: "flow", count: flows.length }
  ].filter((entry) => entry.count > 0);

  return {
    nodeTypes: nodeTypeCounts,
    edgeTypes: [...edgeTypeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type)),
    summary: `Graph schema includes ${nodeTypeCounts.length} node type${nodeTypeCounts.length === 1 ? "" : "s"} and ${edgeTypeCounts.size} edge type${edgeTypeCounts.size === 1 ? "" : "s"}.`
  };
}

function buildAreaSummary({ label, path: areaPath, type, fileCount, symbolCount, entrypoints, languages }) {
  const entryText = entrypoints.length ? ` Entrypoints: ${entrypoints.slice(0, 3).map((entry) => entry.path).join(", ")}.` : "";
  const languageText = languages.length ? ` Languages: ${languages.join(", ")}.` : "";
  return `${label} (${type} at ${areaPath}) groups ${fileCount} files and ${symbolCount} symbols.${entryText}${languageText}`.trim();
}

function buildFlowSummary({ entryPath, label, symbolCount, fileCount, moduleCount, topFiles }) {
  const fileText = topFiles.length ? ` Top files: ${topFiles.join(", ")}.` : "";
  return `Flow ${label} starts from ${entryPath} and reaches ${symbolCount} symbols across ${fileCount} files and ${moduleCount} modules.${fileText}`.trim();
}
