export const forgeMemoryStatusTool = {
  name: "forge_memory_status",
  description: "Show the global ContextForge memory stack status for prompts like `what memory do we have`, `is long-term memory enabled`, or `show wake-up layers and counts`.",
  parameters: {},
  execute(forge: any) {
    return forge.memoryStatus();
  }
};
