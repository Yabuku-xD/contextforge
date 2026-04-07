export const forgeMemoryNavigateTool = {
  name: "forge_memory_navigate",
  description: "Navigate durable memory wings, halls, and rooms for prompts like `show the memory map`, `navigate project memory`, or `what rooms exist under this repo wing`.",
  parameters: {
    wing: "string?",
    hall: "string?",
    room: "string?",
    limit: "number?",
    global: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryNavigate(args);
  }
};
