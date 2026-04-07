export const forgeChangesTool = {
  name: "forge_changes",
  description: "Map git changes to indexed symbols for prompts like `what changed on this branch`, `which files or functions are affected by this diff`, `summarize the current changes by area`, `what touched this branch`, or `what did this commit change`.",
  parameters: {
    scope: "string?",
    base_ref: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.changes({
      scope: args.scope,
      baseRef: args.base_ref
    });
  }
};
