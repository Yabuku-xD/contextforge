export const forgeStartupTool = {
  name: "forge_start",
  description: "Warm ContextForge for the current task, eagerly read and index the whole repository at session start, and establish session paging state.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.startup(args.query ?? "");
  }
};
