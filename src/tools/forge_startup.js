export const forgeStartupTool = {
  name: "forge_start",
  description: "Warm ContextForge for the current task and establish session paging state. On large repositories, forge_start may queue the eager full-repository prime in the background so it can return immediately.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.startup(args.query ?? "");
  }
};
