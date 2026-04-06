export const forgeWalkTool = {
  name: "forge_walk",
  description: "Exhaustive repository walk for prompts like `go through every file`, `read the whole repo`, `cover every folder and subfolder`, or `did you actually read everything`. For explicit all-files prompts it opens every repository file locally, reads text bodies, scans binary assets, and returns a compact authoritative digest for the first answer so Claude does not need to call forge_read, forge_batch, or any other follow-up tools unless the user explicitly asks for drilldown.",
  parameters: { query: "string?" },
  execute(forge: any, args: any = {}) {
    return forge.walk(args.query ?? "");
  }
};
