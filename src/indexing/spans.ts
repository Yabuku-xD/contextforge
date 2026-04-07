export function sliceByNode(source, node): string {
  return source.slice(node.startIndex, node.endIndex);
}

export function spanOfNode(node): { spanStart: number; spanEnd: number } {
  return {
    spanStart: node.startIndex,
    spanEnd: node.endIndex
  };
}
