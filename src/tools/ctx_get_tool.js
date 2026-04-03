export const ctxGetTool = {
  name: "forge_tools",
  description: "Returns ContextForge tool schemas or lists available tools.",
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
