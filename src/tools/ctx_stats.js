export const ctxStats = {
  name: "ctx_stats",
  description: "Show compression, retrieval, and pager stats.",
  parameters: {},
  execute(forge) {
    return forge.stats();
  }
};
