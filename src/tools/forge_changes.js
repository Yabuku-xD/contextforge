export const forgeChangesTool = {
  name: "forge_changes",
  description: "Map git changes to indexed symbols and likely impact candidates.",
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
