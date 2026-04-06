export function createRenameMap() {
  return new Map();
}

export function resolveRename(renameMap, canonicalName) {
  return renameMap.get(canonicalName) ?? canonicalName;
}
