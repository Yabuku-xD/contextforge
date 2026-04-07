import { makeId } from "./canonicalize.js";
import { sha1 } from "../utils/hash.js";

export function createFallbackFileArtifacts({ repoId, fileId, relativePath, language, content }): any {
  const chunkId = makeId("chunk", `${relativePath}:file`);
  const symbolId = makeId("symbol", `${relativePath}:file`);

  return {
    symbols: [
      {
        symbolId,
        repoId,
        fileId,
        canonicalName: `${relativePath}::file`,
        displayName: relativePath,
        kind: "file",
        language,
        spanStart: 0,
        spanEnd: content.length,
        parentSymbolId: null,
        symbolHash: sha1(content),
        body: content
      }
    ],
    chunks: [
      {
        chunkId,
        repoId,
        fileId,
        chunkType: "file",
        label: relativePath,
        text: content,
        summary: null,
        spanStart: 0,
        spanEnd: content.length,
        chunkHash: sha1(content),
        invalidationState: "fresh"
      }
    ]
  };
}
