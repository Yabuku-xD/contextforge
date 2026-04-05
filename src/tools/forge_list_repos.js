export const forgeListReposTool = {
  name: "forge_list_repos",
  description: "List repositories registered in the global ContextForge registry for prompts like `what repos does ContextForge know about` or `show my indexed repositories`.",
  parameters: {},
  execute(forge) {
    return forge.listRepos();
  }
};
