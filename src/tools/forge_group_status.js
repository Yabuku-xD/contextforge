export const forgeGroupStatusTool = {
  name: "forge_group_status",
  description: "Return index and coverage status for all repositories in a ContextForge group.",
  parameters: {
    group_name: "string"
  },
  execute(forge, args = {}) {
    return forge.groupStatus(args.group_name ?? "");
  }
};
