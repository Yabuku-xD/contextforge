export const forgeListReposTool = {
  name: "forge_list_repos",
  description: "List repositories registered in the global ContextForge registry.",
  parameters: {},
  execute(forge) {
    return forge.listRepos();
  }
};
