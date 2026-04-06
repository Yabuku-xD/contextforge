export const forgeStartupTool = {
  name: "forge_start",
  description: "Warm ContextForge and check index status for prompts like `understand this repo`, `start with repo context`, `is the index ready`, or before any non-trivial repository task. On large repositories, forge_start may queue the eager full-repository prime in the background so it can return immediately.",
  parameters: { query: "string?" },
  execute(forge: any, args: any = {}) {
    return forge.startup(args.query ?? "");
  }
};
