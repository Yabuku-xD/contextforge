export const forgeMemoryFactQueryTool = {
  name: "forge_memory_fact_query",
  description: "Query remembered facts for prompts like `what facts do we know about X`, `show relationships for Y`, or `verify this remembered fact`.",
  parameters: {
    entity: "string",
    asOf: "string?",
    direction: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryFactQuery(args.entity ?? "", args);
  }
};
