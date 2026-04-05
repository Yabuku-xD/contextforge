export const forgeWikiTool = {
  name: "forge_wiki",
  description: "Generate a compact repository wiki artifact for prompts like `make a repo wiki`, `generate documentation from the index`, or `give me living docs for this project`.",
  parameters: {
    query: "string?"
  },
  execute(forge, args = {}) {
    return forge.wiki(args.query ?? "");
  }
};
