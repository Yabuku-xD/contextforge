export const forgeMapTool = {
  name: "forge_map",
  description: "Generate a repository architecture map artifact for prompts like `make me a repo map`, `show the architecture map`, or `summarize the system layout as an artifact`.",
  parameters: {
    query: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.map(args.query ?? "");
  }
};
