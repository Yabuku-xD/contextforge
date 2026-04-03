import path from "node:path";
import { sha1 } from "../utils/hash.js";

export function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if ([".ts", ".tsx", ".mts", ".cts"].includes(ext)) return "typescript";
  if (ext === ".json") return "json";
  if ([".md", ".mdx", ".txt"].includes(ext)) return "markdown";
  return "text";
}

export function canonicalSymbolName({ relativePath, parentPath = [], displayName }) {
  const chain = [relativePath, ...parentPath, displayName].filter(Boolean).join("::");
  return chain;
}

export function makeId(prefix, value) {
  return `${prefix}_${sha1(value)}`;
}
