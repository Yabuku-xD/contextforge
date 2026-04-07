export const forgeMemoryWakeupTool = {
  name: "forge_memory_wakeup",
  description: "Load the compact wake-up memory capsule for prompts like `what should you remember before we continue`, `load prior decisions`, `wake up memory for this repo`, or `remind yourself what matters before the next step`.",
  parameters: {
    includeProtocol: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryWakeup(args);
  }
};
