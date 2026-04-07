export const forgeMemoryFactInvalidateTool = {
  name: "forge_memory_fact_invalidate",
  description: "Invalidate a remembered fact for prompts like `this is no longer true`, `retire this fact`, or `mark this relationship as ended`.",
  parameters: {
    subject: "string",
    predicate: "string",
    object: "string",
    ended: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryFactInvalidate(args);
  }
};
