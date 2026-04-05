export const forgeGroupQueryTool = {
  name: "forge_group_query",
  description: "Search across all repositories in a named ContextForge group.",
  parameters: {
    group_name: "string",
    query: "string",
    limit: "number?"
  },
  execute(forge, args = {}) {
    return forge.groupQuery(args.group_name ?? "", args.query ?? "", {
      limit: normalizeLimit(args.limit)
    });
  }
};

function normalizeLimit(limit) {
  const parsed = typeof limit === "string" ? Number.parseInt(limit, 10) : limit;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 4;
  }
  return Math.min(Math.trunc(parsed), 10);
}
