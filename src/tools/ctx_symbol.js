export const ctxSymbol = {
  name: "forge_symbol",
  description: "Exact and fuzzy symbol lookup.",
  parameters: { query: "string", limit: "number?" },
  execute(forge, args = {}) {
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
