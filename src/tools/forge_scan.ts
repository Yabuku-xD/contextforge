export const forgeScanTool = {
  name: "forge_scan",
  description: "Fast first-pass repository scan for prompts like `what is this repo`, `give me a quick repo overview`, `show the top-level folders`, or `where should I start`; use this to answer the initial repo-overview question without manually reading lots of files first.",
  parameters: {},
  execute(forge) {
    return forge.scan("");
  }
};
