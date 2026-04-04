import path from "node:path";
import { walkFiles, readText, relativeTo } from "../utils/fs.js";
import { sha1 } from "../utils/hash.js";
import { classifyFileOrigin } from "./generated-filter.js";
import { detectLanguage, makeId } from "./canonicalize.js";

export function loadRepositoryFiles(rootDir, repoId) {
  return walkFiles(rootDir).map((filePath) => loadRepositoryFile(rootDir, repoId, filePath));
}

export function loadRepositoryInventory(rootDir, repoId) {
  return walkFiles(rootDir).map((filePath) => loadRepositoryInventoryEntry(rootDir, repoId, filePath));
}

export function loadRepositoryFile(rootDir, repoId, filePath) {
  const inventory = loadRepositoryInventoryEntry(rootDir, repoId, filePath);
  const content = readText(inventory.absolutePath);

  return {
    ...inventory,
    fileHash: sha1(content),
    content
  };
}

export function loadRepositoryInventoryEntry(rootDir, repoId, filePath) {
  const relativePath = relativeTo(rootDir, filePath);
  const language = detectLanguage(relativePath);
  const origin = classifyFileOrigin(relativePath);
  const fileId = makeId("file", relativePath);

  return {
    fileId,
    repoId,
    absolutePath: path.resolve(filePath),
    relativePath,
    language,
    ...origin
  };
}
