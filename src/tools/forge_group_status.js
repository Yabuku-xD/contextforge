export const forgeGroupStatusTool = {
  name: "forge_group_status",
  description: "Return index and coverage status for all repositories in a ContextForge group for prompts like `which repos in this group are indexed` or `show status for every repo in the group`.",
  parameters: {
    group_name: "string"
  },
  execute(forge, args = {}) {
    return forge.groupStatus(args.group_name ?? "");
  }
};
