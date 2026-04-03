export const ctxScan = {
  name: "forge_scan",
  description: "Fast first-pass repository scan for prompts like understand this whole repo, map the folders and packages, or explain what each area does. No query required.",
  parameters: {},
  execute(forge) {
    return forge.understand("");
  }
};
