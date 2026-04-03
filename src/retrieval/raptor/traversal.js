export function traversalSearch(query, raptorNodes, limit = 10) {
  const lowered = String(query ?? "").toLowerCase();
  const modules = raptorNodes.filter((node) => node.nodeType === "module");
  const files = raptorNodes.filter((node) => node.nodeType === "file");
  const symbols = raptorNodes.filter((node) => node.nodeType === "symbol");

  const bestModule = modules
    .map((node) => ({ node, score: scoreNode(node, lowered) }))
    .sort((left, right) => right.score - left.score)[0];

  const selectedFiles = files.filter((node) => node.parentNodeId === bestModule?.node.nodeId);
  const selectedSymbols = symbols.filter((node) => selectedFiles.some((file) => file.nodeId === node.parentNodeId));

  return selectedSymbols
    .map((node) => ({ id: node.nodeId, label: node.label, node, score: scoreNode(node, lowered) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function scoreNode(node, loweredQuery) {
  let score = 0;
  const haystack = `${node.label}\n${node.summary ?? ""}`.toLowerCase();
  for (const token of loweredQuery.split(/\s+/).filter(Boolean)) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
}
