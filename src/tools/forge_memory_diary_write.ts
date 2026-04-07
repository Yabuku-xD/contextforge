export const forgeMemoryDiaryWriteTool = {
  name: "forge_memory_diary_write",
  description: "Write a diary-style memory entry for prompts like `journal this session`, `save a diary note`, or `write a checkpoint note`.",
  parameters: {
    title: "string",
    entryText: "string",
    aaak: "string?",
    tags: "string[]?",
    agentId: "string?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryDiaryWrite(args);
  }
};
