export const forgeSymbolTool = {
  name: "forge_symbol",
  description: "Find exact or fuzzy symbols for prompts like `where is function X defined`, `show me the Foo class`, `find symbol named bar`, `jump to this identifier`, `where is createCheckout`, or `take me to the definition of this method`.",
  parameters: { query: "string", limit: "number?" },
  execute(forge: any, args: any = {}) {
    return forge.symbol(args.query ?? "", { limit: normalizeLimit(args.limit) });
  }
};

function normalizeLimit(limit) {
  const parsed = typeof limit === "string" ? Number.parseInt(limit, 10) : limit;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.min(Math.trunc(parsed), 50);
}
