export const forgeMapTool = {
  name: "forge_map",
  description: "Generate a repository architecture map artifact from the current ContextForge index.",
  parameters: {
    query: "string?"
  },
  execute(forge, args = {}) {
    return forge.map(args.query ?? "");
  }
};
