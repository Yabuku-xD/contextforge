export const ctxStats = {
  name: "forge_stats",
  description: "Show compression, retrieval, and pager stats.",
  parameters: {},
  execute(forge) {
    return forge.stats();
  }
};
