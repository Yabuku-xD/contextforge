export const forgeImpactTool = {
  name: "forge_impact",
  description: "Thin PDG and graph-backed impact analysis.",
  parameters: { query: "string" },
  execute(forge, args = {}) {
    return forge.impact(args.query ?? "");
  }
};
