export const ctxScan = {
  name: "forge_scan",
  description: "Fast first-pass repository scan for prompts like understand this whole repo, map the folders and packages, or explain what each area does. Use this to answer the initial repo-overview question without manually reading lots of files first.",
  parameters: {},
  execute(forge) {
    return forge.scan("");
  }
};
