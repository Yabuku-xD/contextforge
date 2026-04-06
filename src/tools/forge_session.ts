export const forgeSessionTool = {
  name: "forge_session",
  description: "Query current session memory for prompts like `what happened in this session`, `what files have we touched`, or `what decisions have we made so far`.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.session(args.query ?? "");
  }
};
