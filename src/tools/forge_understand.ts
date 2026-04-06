export const forgeUnderstandTool = {
  name: "forge_understand",
  description: "Broad repository understanding for prompts like `understand this project`, `explain the architecture`, `what does this codebase do`, or `show me the important packages and files`. Uses a fast inventory-first path for normal prompts and automatically escalates to a deeper file-audited repo walk for explicit all-files prompts. For initial orientation, prefer answering from this tool instead of manually reading many files.",
  parameters: { query: "string?" },
  execute(forge: any, args: any = {}) {
    return forge.understand(args.query ?? "");
  }
};
