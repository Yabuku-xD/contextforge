export function normalizeWhitespace(value): string {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

export function normalizeIdentifier(value): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:/.-]+/g, "_");
}

export function tokenize(value): string[] {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9_:/.-]+/g)
    .filter(Boolean);
}

export function unique(values): any[] {
  return [...new Set(values)];
}

export function clip(value, maxLength = 240): string {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

export function estimateTokens(value): number {
  return Math.ceil(String(value ?? "").length / 4);
}

export function cosineSimilarity(left, right): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (!leftNorm || !rightNorm) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
