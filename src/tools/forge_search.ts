export const forgeSearchTool = {
  name: "forge_search",
  description: "Hybrid repository search for prompts like `find where X is implemented`, `which file handles Y`, `search for this behavior`, or `locate the code path for Z`.",
  parameters: { query: "string", limit: "number?" },
  execute(forge, args = {}) {
    return forge.search(args.query ?? "", { limit: normalizeLimit(args.limit) });
  }
};

function normalizeLimit(limit) {
  const parsed = typeof limit === "string" ? Number.parseInt(limit, 10) : limit;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }
  return Math.min(Math.trunc(parsed), 50);
}
