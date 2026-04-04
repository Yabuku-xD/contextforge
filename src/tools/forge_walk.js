export const forgeWalkTool = {
  name: "forge_walk",
  description: "Deeper repository walk for exhaustive prompts like going through every file, folder, subfolder, package, or module. For explicit all-files prompts it opens every repository file locally, reads text bodies, scans binary assets, and returns a compact package-by-package and directory-by-directory digest so Claude can answer broad repo questions before spawning Explore agents or manually reading many files.",
  parameters: { query: "string?" },
  execute(forge, args = {}) {
    return forge.walk(args.query ?? "");
  }
};
