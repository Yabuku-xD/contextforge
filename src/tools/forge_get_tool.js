export const forgeGetTool = {
  name: "forge_tools",
  description: "List ContextForge tools or inspect a tool schema for prompts like `what can ContextForge do` or `show me the input for forge_walk`.",
  parameters: {
    tool_name: "string | 'list'"
  },
  execute(forge, args = {}) {
    const toolName = args.tool_name ?? "list";
    if (toolName === "list") {
      return forge.listTools().map((name) => ({ name }));
    }
    return { name: toolName };
  }
};
