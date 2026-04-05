export const forgeContractsTool = {
  name: "forge_contracts",
  description: "Generate cross-area dependency contracts from the current ContextForge graph.",
  parameters: {
    query: "string?"
  },
  execute(forge, args = {}) {
    return forge.contracts(args.query ?? "");
  }
};
