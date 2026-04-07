import path from "node:path";

export function pageAffinity(page: Record<string, any>, context: Record<string, any> = {}): { activeFileMatch: boolean; activeSymbolMatch: boolean; failureMatch: boolean; hotToolMatch: boolean; keepScore: number } {
  const sourceId = String(page.sourceItemId ?? "");
  const normalizedId = sourceId.toLowerCase();
  const activeFileMatch = (context.activeFiles ?? []).some((filePath) =>
    normalizedId === String(filePath).toLowerCase() ||
    normalizedId.endsWith(`/${path.basename(String(filePath)).toLowerCase()}`) ||
    String(filePath).toLowerCase().includes(normalizedId)
  );
  const activeSymbolMatch = (context.activeSymbols ?? []).some((symbolId) => normalizedId === String(symbolId).toLowerCase());
  const failureMatch = (context.failureFiles ?? []).some((filePath) => normalizedId.includes(path.basename(String(filePath)).toLowerCase())) ||
    (context.failureSymbols ?? []).some((symbolId) => normalizedId === String(symbolId).toLowerCase());
  const hotToolMatch = (context.hotTools ?? []).some((toolName) => normalizedId === String(toolName).toLowerCase());

  const pageTypeBonus = {
    core_instructions: 6,
    module: 8,
    retrieval_pack: 10,
    session_memory: 12,
    tool_schema: 9
  }[page.pageType] ?? 4;

  const keepScore =
    pageTypeBonus +
    (activeFileMatch ? 18 : 0) +
    (activeSymbolMatch ? 18 : 0) +
    (failureMatch ? 22 : 0) +
    (hotToolMatch ? 12 : 0);

  return {
    activeFileMatch,
    activeSymbolMatch,
    failureMatch,
    hotToolMatch,
    keepScore
  };
}
