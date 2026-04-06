export function sliceByNode(source, node) {
  return source.slice(node.startIndex, node.endIndex);
}

export function spanOfNode(node) {
  return {
    spanStart: node.startIndex,
    spanEnd: node.endIndex
  };
}
