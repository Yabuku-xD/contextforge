export const ctxSymbol = {
  name: "ctx_symbol",
  description: "Exact and fuzzy symbol lookup.",
  parameters: { query: "string", limit: "number?" },
  execute(forge, args = {}) {
    return forge.symbol(args.query ?? "", { limit: args.limit ?? 10 });
  }
};
