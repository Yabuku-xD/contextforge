import { makeId } from "../indexing/canonicalize.js";
import { edgeConfidence } from "./confidence.js";

export function buildRepoGraph({ repoId, files, symbols, pdgEdges, raptorNodes = [] }) {
  const nodes = [];
  const edges = [];
  const moduleNodes = raptorNodes.filter((node) => node.nodeType === "module");
  const moduleById = new Map(moduleNodes.map((node) => [node.nodeId, node]));
  const fileModuleParent = new Map(
    raptorNodes
      .filter((node) => node.nodeType === "file" && node.parentNodeId)
      .map((node) => [node.sourceItemId, node.parentNodeId])
  );

  for (const file of files) {
    nodes.push({ id: file.fileId, type: "file", label: file.relativePath });
  }

  for (const moduleNode of moduleNodes) {
    nodes.push({ id: moduleNode.nodeId, type: "module", label: moduleNode.label });
  }

  for (const symbol of symbols) {
    nodes.push({ id: symbol.symbolId, type: "symbol", label: symbol.canonicalName });
    edges.push({
      edgeId: makeId("graph", `${symbol.symbolId}:file:${symbol.fileId}`),
      repoId,
      fromSymbolId: symbol.symbolId,
      toSymbolId: symbol.fileId,
      edgeType: "defined_in",
      confidence: 1,
      provenanceSource: "symbol_file"
    });
    edges.push({
      edgeId: makeId("graph", `${symbol.fileId}:contains:${symbol.symbolId}`),
      repoId,
      fromSymbolId: symbol.fileId,
      toSymbolId: symbol.symbolId,
      edgeType: "contains",
      confidence: 0.95,
      provenanceSource: "file_symbol"
    });

    if (/test/i.test(symbol.canonicalName)) {
      edges.push({
        edgeId: makeId("graph", `${symbol.symbolId}:tested_by:${symbol.fileId}`),
        repoId,
        fromSymbolId: symbol.fileId,
        toSymbolId: symbol.symbolId,
        edgeType: "tested_by",
        confidence: edgeConfidence("tested_by"),
        provenanceSource: "test_name_heuristic"
      });
    }
  }

  for (const file of files) {
    const moduleId = fileModuleParent.get(file.fileId);
    if (!moduleId || !moduleById.has(moduleId)) {
      continue;
    }

    edges.push({
      edgeId: makeId("graph", `${moduleId}:contains:${file.fileId}`),
      repoId,
      fromSymbolId: moduleId,
      toSymbolId: file.fileId,
      edgeType: "contains",
      confidence: 0.9,
      provenanceSource: "module_file"
    });
    edges.push({
      edgeId: makeId("graph", `${file.fileId}:part_of:${moduleId}`),
      repoId,
      fromSymbolId: file.fileId,
      toSymbolId: moduleId,
      edgeType: "part_of",
      confidence: 0.75,
      provenanceSource: "file_module"
    });
  }

  for (const edge of pdgEdges) {
    edges.push({
      ...edge,
      confidence: edge.confidence ?? edgeConfidence(edge.edgeType)
    });
  }

  return { nodes, edges: dedupeEdges(edges) };
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
