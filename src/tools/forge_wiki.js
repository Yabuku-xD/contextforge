export const forgeWikiTool = {
  name: "forge_wiki",
  description: "Generate a compact repository wiki artifact from the current ContextForge index.",
  parameters: {
    query: "string?"
  },
  execute(forge, args = {}) {
    return forge.wiki(args.query ?? "");
  }
};
