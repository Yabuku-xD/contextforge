export const forgeMemoryTimelineTool = {
  name: "forge_memory_timeline",
  description: "Show a temporal memory timeline for prompts like `timeline of X`, `what changed over time`, or `show remembered history`.",
  parameters: {
    entity: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryTimeline(args.entity ?? "");
  }
};
