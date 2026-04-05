export const forgeChangesTool = {
  name: "forge_changes",
  description: "Map git changes to indexed symbols for prompts like `what changed on this branch`, `which files or functions are affected by this diff`, or `summarize the current changes by area`.",
  parameters: {
    scope: "string?",
    base_ref: "string?"
  },
  execute(forge, args = {}) {
    return forge.changes({
      scope: args.scope,
      baseRef: args.base_ref
    });
  }
};
