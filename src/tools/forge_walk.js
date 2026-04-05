export const forgeWalkTool = {
  name: "forge_walk",
  description: "Deeper repository walk for exhaustive prompts like going through every file, folder, subfolder, package, or module. For explicit all-files prompts it opens every repository file locally, reads text bodies, scans binary assets, and returns a compact authoritative digest for the first answer so Claude does not need to call forge_read, forge_batch, or any other follow-up tools unless the user explicitly asks for drilldown.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.walk(args.query ?? "");
  }
};
