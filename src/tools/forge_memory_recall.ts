export const forgeMemoryRecallTool = {
  name: "forge_memory_recall",
  description: "Load layered scoped recall for prompts like `what do we know about auth`, `show recent project memory`, or `recall notes from this repo/topic`.",
  parameters: {
    query: "string?",
    wing: "string?",
    hall: "string?",
    room: "string?",
    limit: "number?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryRecall(args.query ?? "", args);
  }
};
