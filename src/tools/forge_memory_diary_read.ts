export const forgeMemoryDiaryReadTool = {
  name: "forge_memory_diary_read",
  description: "Read diary entries for prompts like `show recent diary notes`, `what did we journal`, or `load checkpoints from earlier sessions`.",
  parameters: {
    agentId: "string?",
    sessionId: "string?",
    sessionOnly: "boolean?",
    limit: "number?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryDiaryRead(args);
  }
};
