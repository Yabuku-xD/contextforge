export const forgeUnderstandTool = {
  name: "forge_understand",
  description: "Broad repository understanding for prompts like understanding the whole repo or monorepo, going through every file or folder, mapping packages, entrypoints, and the most important files to read first. Uses a fast inventory-first path for normal prompts and automatically escalates to a deeper file-audited repo walk for explicit all-files prompts. For initial orientation, prefer answering from this tool instead of manually reading many files.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.understand(args.query ?? "");
  }
};
