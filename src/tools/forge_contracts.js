export const forgeContractsTool = {
  name: "forge_contracts",
  description: "Generate cross-area dependency contracts for prompts like `show the boundaries between modules`, `which areas depend on each other`, or `generate the integration contracts for this repo`.",
  parameters: {
    query: "string?"
  },
  execute(forge, args = {}) {
    return forge.contracts(args.query ?? "");
  }
};
