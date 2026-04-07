export const forgeMemorySaveTool = {
  name: "forge_memory_save",
  description: "Save a durable decision, discovery, preference, or note for prompts like `remember this`, `save this decision`, or `store this long-term`.",
  parameters: {
    title: "string",
    summary: "string",
    detail: "string?",
    wing: "string?",
    hall: "string?",
    room: "string?",
    tags: "string[]?",
    entities: "string[]?",
    importance: "number?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memorySave(args);
  }
};
