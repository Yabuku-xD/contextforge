export const forgeStatsTool = {
  name: "forge_stats",
  description: "Show compression, retrieval, and pager stats.",
  parameters: {},
  execute(forge) {
    return forge.stats();
  }
};
