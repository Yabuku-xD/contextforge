export const ctxUnderstand = {
  name: "forge_understand",
  description: "Broad repository understanding for fuzzy prompts about project structure, folders, packages, entrypoints, and important files.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.understand(args.query ?? "");
  }
};
