export const forgeMemorySearchTool = {
  name: "forge_memory_search",
  description: "Deep-search global or repo memory for prompts like `search remembered decisions about X`, `find past notes`, or `what do you remember about this person/project`.",
  parameters: {
    query: "string",
    wing: "string?",
    hall: "string?",
    room: "string?",
    limit: "number?",
    asOf: "string?",
    includeDiaries: "boolean?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memorySearch(args.query ?? "", args);
  }
};
