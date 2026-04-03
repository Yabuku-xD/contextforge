export const forgeSessionTool = {
  name: "forge_session",
  description: "Query the current session memory.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.session(args.query ?? "");
  }
};
