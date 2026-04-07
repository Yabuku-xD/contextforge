export const forgeMemoryProfileSetTool = {
  name: "forge_memory_profile_set",
  description: "Set a long-term memory profile for prompts like `set identity memory`, `save project profile`, or `update long-term profile`.",
  parameters: {
    profileType: "string?",
    name: "string",
    summary: "string",
    aaak: "string?",
    metadata: "any?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryProfileSet(args);
  }
};
