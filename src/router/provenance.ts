import { sha1 } from "../utils/hash.js";

export function createProvenance({
  sourceType,
  sourceId,
  filePath = null,
  spanStart = null,
  spanEnd = null,
  policyClass = "exact",
  compressor = "none"
}) {
  return {
    provenanceId: sha1(`${sourceType}:${sourceId}:${filePath ?? ""}:${spanStart ?? ""}:${spanEnd ?? ""}`),
    sourceType,
    sourceId,
    filePath,
    spanStart,
    spanEnd,
    policyClass,
    compressor
  };
}
