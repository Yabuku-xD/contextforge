import path from "node:path";
import { makeId } from "../../indexing/canonicalize.js";
import { summarizeChildren } from "./summaries.js";

export function buildRaptorTree({ repoId, files, symbols }) {
  const nodes = [];
  const byFile = new Map();

  for (const file of files) {
    const fileNode = {
      nodeId: makeId("raptor", `file:${file.relativePath}`),
      repoId,
      parentNodeId: null,
      nodeType: "file",
      label: file.relativePath,
      summary: null,
      tokenBudget: 256,
      sourceItemType: "file",
      sourceItemId: file.fileId,
      cacheState: "cold"
    };
    byFile.set(file.fileId, fileNode);
    nodes.push(fileNode);
  }

  const byDirectory = new Map();
  for (const file of files) {
    const directory = path.dirname(file.relativePath);
    if (!byDirectory.has(directory)) {
      const moduleNode = {
        nodeId: makeId("raptor", `module:${directory}`),
        repoId,
        parentNodeId: null,
        nodeType: "module",
        label: directory === "." ? "root" : directory,
        summary: null,
        tokenBudget: 320,
        sourceItemType: "module",
        sourceItemId: directory,
        cacheState: "cold"
      };
      byDirectory.set(directory, moduleNode);
      nodes.push(moduleNode);
    }

    byFile.get(file.fileId).parentNodeId = byDirectory.get(directory).nodeId;
  }

  for (const symbol of symbols) {
    nodes.push({
      nodeId: makeId("raptor", `symbol:${symbol.symbolId}`),
      repoId,
      parentNodeId: byFile.get(symbol.fileId)?.nodeId ?? null,
      nodeType: "symbol",
      label: symbol.canonicalName,
      summary: symbol.displayName,
      tokenBudget: 160,
      sourceItemType: "symbol",
      sourceItemId: symbol.symbolId,
      cacheState: "warm"
    });
  }

  const childrenByParent = new Map();
  for (const node of nodes) {
    if (!node.parentNodeId) continue;
    if (!childrenByParent.has(node.parentNodeId)) childrenByParent.set(node.parentNodeId, []);
    childrenByParent.get(node.parentNodeId).push(node);
  }

  for (const node of nodes) {
    if (!["file", "module"].includes(node.nodeType)) continue;
    const children = childrenByParent.get(node.nodeId) ?? [];
    node.summary = summarizeChildren(node, children);
  }

  return nodes;
}
