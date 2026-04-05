export const forgeImpactTool = {
  name: "forge_impact",
  description: "Estimate blast radius for prompts like `what breaks if I change X`, `who depends on this`, `what else is affected by this file`, or `show the impact of this symbol`.",
  parameters: { query: "string" },
  execute(forge, args = {}) {
    return forge.impact(args.query ?? "");
  }
};
