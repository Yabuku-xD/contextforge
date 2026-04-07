export const forgeImpactTool = {
  name: "forge_impact",
  description: "Estimate blast radius for prompts like `what breaks if I change X`, `who depends on this`, `what else is affected by this file`, `show the impact of this symbol`, `what depends on this`, or `show downstream fallout if I touch this`.",
  parameters: { query: "string" },
  execute(forge: any, args: any = {}) {
    return forge.impact(args.query ?? "");
  }
};
