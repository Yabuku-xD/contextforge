import fs from "node:fs";
import path from "node:path";
import { walkFiles, relativeTo } from "../utils/fs.js";
import { sha1 } from "../utils/hash.js";
import { classifyFileOrigin } from "./generated-filter.js";
import { detectLanguage, makeId } from "./canonicalize.js";

export function loadRepositoryFiles(rootDir, repoId): any[] {
  return walkFiles(rootDir).map((filePath) => loadRepositoryFile(rootDir, repoId, filePath));
}

export function loadRepositoryInventory(rootDir, repoId): any[] {
  return walkFiles(rootDir).map((filePath) => loadRepositoryInventoryEntry(rootDir, repoId, filePath));
}

export function loadRepositoryFile(rootDir, repoId, filePath): any {
  const inventory = loadRepositoryInventoryEntry(rootDir, repoId, filePath);
  const buffer = fs.readFileSync(inventory.absolutePath);
  const isBinary = looksBinary(buffer, inventory.relativePath);
  const content = isBinary ? "" : buffer.toString("utf8");

  return {
    ...inventory,
    fileHash: sha1(isBinary ? buffer.toString("base64") : content),
    content,
    contentKind: isBinary ? "binary" : "text",
    contentLoaded: !isBinary,
    byteCount: buffer.length,
    lineCount: isBinary ? 0 : countTextLines(content)
  };
}

export function loadRepositoryInventoryEntry(rootDir, repoId, filePath): any {
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

function looksBinary(buffer, filePath = "") {
  const ext = path.extname(String(filePath ?? "").toLowerCase());
  if ([
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tar",
    ".tgz", ".mp3", ".mp4", ".mov", ".avi", ".wasm", ".woff", ".woff2", ".ttf", ".otf"
  ].includes(ext)) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

function countTextLines(content) {
  if (!content) {
    return 0;
  }

  return String(content).split(/\r?\n/).length;
}
