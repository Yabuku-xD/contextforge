import { canonicalSymbolName, makeId } from "./canonicalize.js";
import { sliceByNode, spanOfNode } from "./spans.js";
import { sha1 } from "../utils/hash.js";

const SYMBOL_NODE_TYPES = new Set([
  "arrow_function",
  "class_declaration",
  "function_declaration",
  "generator_function_declaration",
  "lexical_declaration",
  "method_definition"
]);

export function extractSymbols({ repoId, fileId, relativePath, language, tree, content }) {
  const symbols = [];
  const chunks = [];
  const parentPath = [];

  visit(tree.rootNode, parentPath);
  return { symbols, chunks };

  function visit(node, currentParentPath) {
    if (SYMBOL_NODE_TYPES.has(node.type)) {
      const symbol = maybeMakeSymbol(node, currentParentPath);
      if (symbol) {
        symbols.push(symbol);
        chunks.push(makeChunk(symbol));
        const nextParentPath = [...currentParentPath, symbol.displayName];
        node.namedChildren.forEach((child) => visit(child, nextParentPath));
        return;
      }
    }

    node.namedChildren.forEach((child) => visit(child, currentParentPath));
  }

  function maybeMakeSymbol(node, currentParentPath) {
    const displayName = extractDisplayName(node);
    if (!displayName) {
      return null;
    }

    const body = sliceByNode(content, node);
    const canonicalName = canonicalSymbolName({ relativePath, parentPath: currentParentPath, displayName });
    const symbolId = makeId("symbol", canonicalName);
    const span = spanOfNode(node);

    return {
      symbolId,
      repoId,
      fileId,
      canonicalName,
      displayName,
      kind: node.type,
      language,
      ...span,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      parentSymbolId: currentParentPath.length ? makeId("symbol", canonicalSymbolName({
        relativePath,
        parentPath: currentParentPath.slice(0, -1),
        displayName: currentParentPath[currentParentPath.length - 1]
      })) : null,
      symbolHash: sha1(body),
      body
    };
  }

  function makeChunk(symbol) {
    return {
      chunkId: makeId("chunk", symbol.symbolId),
      repoId,
      fileId,
      chunkType: "symbol",
      label: symbol.canonicalName,
      text: symbol.body,
      summary: null,
      spanStart: symbol.spanStart,
      spanEnd: symbol.spanEnd,
      chunkHash: symbol.symbolHash,
      invalidationState: "fresh"
    };
  }
}

function extractDisplayName(node) {
  if (node.type === "function_declaration" || node.type === "generator_function_declaration" || node.type === "class_declaration") {
    return node.childForFieldName("name")?.text ?? null;
  }

  if (node.type === "method_definition") {
    return node.childForFieldName("name")?.text ?? null;
  }

  if (node.type === "lexical_declaration") {
    for (const child of node.namedChildren) {
      if (child.type === "variable_declarator") {
        return child.childForFieldName("name")?.text ?? null;
      }
    }
  }

  if (node.type === "arrow_function") {
    return `arrow_${node.startPosition.row + 1}`;
  }

  return null;
}
