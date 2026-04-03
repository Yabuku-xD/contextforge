export const ctxUnderstand = {
  name: "forge_understand",
  description: "Broad repository understanding for prompts like understanding the whole repo or monorepo, going through every file or folder, mapping packages, entrypoints, and the most important files to read first. Uses a fast inventory-first path and automatically escalates to a deeper repo walk for exhaustive prompts. For initial orientation, prefer answering from this tool instead of manually reading many files.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.understand(args.query ?? "");
  }
};
