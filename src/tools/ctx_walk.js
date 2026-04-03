export const ctxWalk = {
  name: "forge_walk",
  description: "Deeper repository walk for exhaustive prompts like going through every file, folder, subfolder, package, or module. Summarizes each major area with representative files so Claude can answer broad repo questions before spawning Explore agents or manually reading many files.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.walk(args.query ?? "");
  }
};
