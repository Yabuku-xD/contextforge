export const forgeStatsTool = {
  name: "forge_stats",
  description: "Show runtime and index stats for prompts like `how much did ContextForge compress`, `what is the current index state`, or `show retrieval and pager stats`.",
  parameters: {},
  execute(forge) {
    return forge.stats();
  }
};
