import path from "node:path";
import { walkFiles, readText, relativeTo } from "../utils/fs.js";
import { sha1 } from "../utils/hash.js";
import { classifyFileOrigin } from "./generated-filter.js";
import { detectLanguage, makeId } from "./canonicalize.js";

export function loadRepositoryFiles(rootDir, repoId) {
  return walkFiles(rootDir).map((filePath) => {
    const relativePath = relativeTo(rootDir, filePath);
    const content = readText(filePath);
    const language = detectLanguage(relativePath);
    const origin = classifyFileOrigin(relativePath);
    const fileId = makeId("file", relativePath);

    return {
      fileId,
      repoId,
      absolutePath: path.resolve(filePath),
      relativePath,
      language,
      fileHash: sha1(content),
      content,
      ...origin
    };
  });
}
