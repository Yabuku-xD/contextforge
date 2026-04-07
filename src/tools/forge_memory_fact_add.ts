export const forgeMemoryFactAddTool = {
  name: "forge_memory_fact_add",
  description: "Add a temporal remembered fact for prompts like `remember that X uses Y`, `store this fact`, or `record this relationship`.",
  parameters: {
    subject: "string",
    predicate: "string",
    object: "string",
    validFrom: "string?",
    validTo: "string?",
    confidence: "number?",
    sourceEntryId: "string?",
    sourceKind: "string?",
    metadata: "any?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryFactAdd(args);
  }
};
