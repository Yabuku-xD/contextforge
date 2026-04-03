import { vectorSearch, embedText } from "../vectors.js";

export function collapsedTreeSearch(query, raptorNodes, limit = 10) {
  const items = raptorNodes.map((node) => ({
    id: node.nodeId,
    label: node.label,
    node,
    embedding: embedText(`${node.label}\n${node.summary ?? ""}`)
  }));

  return vectorSearch(query, items, limit).map((item) => ({
    id: item.id,
    label: item.label,
    score: item.score,
    node: item.node
  }));
}
