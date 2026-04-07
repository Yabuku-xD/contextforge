export function edgeConfidence(edgeType): number {
  if (edgeType === "call") return 0.8;
  if (edgeType === "data") return 0.55;
  if (edgeType === "import") return 0.6;
  if (edgeType === "tested_by") return 0.7;
  return 0.45;
}
