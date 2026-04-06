export const forgeWhyTool = {
  name: "forge_why",
  description: "Explain why something matters for prompts like `why does this file matter`, `what is this for`, `why is this important`, `why does this code exist`, or `how does this relate to the current task`, using repo and session graphs.",
  parameters: { query: "string" },
  execute(forge: any, args: any = {}) {
    return forge.why(args.query ?? "");
  }
};
