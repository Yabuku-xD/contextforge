export const forgeLookupTool = {
  name: "forge_lookup",
  description: "Search the locally indexed output from prior ContextForge research batches without replaying raw command output into chat.",
  parameters: {
    queries: "string[]",
    source_id: "string?",
    limit: "number?"
  },
  execute(forge, args = {}) {
    return forge.lookup(args.queries, {
      sourceId: args.source_id,
      limit: args.limit
    });
  }
};
