export const forgeLookupTool = {
  name: "forge_lookup",
  description: "Search stored research output for prompts like `search the logs from earlier`, `find the error in the saved test output`, or `query previous command results without replaying raw output into chat`.",
  parameters: {
    queries: "string[]",
    source_id: "string?",
    limit: "number?"
  },
  execute(forge: any, args: any = {}) {
    return forge.lookup(args.queries, {
      sourceId: args.source_id,
      limit: args.limit
    });
  }
};
