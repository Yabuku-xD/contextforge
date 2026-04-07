export const forgeMemoryTimelineTool = {
  name: "forge_memory_timeline",
  description: "Show a temporal memory timeline for prompts like `timeline of X`, `what changed over time`, `show remembered history`, or `when did this fact change`.",
  parameters: {
    entity: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryTimeline(args.entity ?? "");
  }
};
