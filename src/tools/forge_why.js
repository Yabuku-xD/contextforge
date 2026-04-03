export const forgeWhyTool = {
  name: "forge_why",
  description: "Why this symbol or behavior matters based on repo and session graphs.",
  parameters: { query: "string" },
  execute(forge, args = {}) {
    return forge.why(args.query ?? "");
  }
};
