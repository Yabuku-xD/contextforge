export const ctxSearch = {
  name: "forge_search",
  description: "Hybrid code search across exact, BM25, dense, RAPTOR, and graph reranking.",
  parameters: { query: "string", limit: "number?" },
  execute(forge, args = {}) {
    return forge.search(args.query ?? "", { limit: args.limit ?? 10 });
  }
};
