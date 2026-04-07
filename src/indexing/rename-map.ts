export function createRenameMap(): Map<string, string> {
  return new Map();
}

export function resolveRename(renameMap, canonicalName): string {
  return renameMap.get(canonicalName) ?? canonicalName;
}
