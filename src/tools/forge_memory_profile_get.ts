export const forgeMemoryProfileGetTool = {
  name: "forge_memory_profile_get",
  description: "Read identity or project memory profiles for prompts like `show identity memory`, `show project profile`, or `list memory profiles`.",
  parameters: {
    profileType: "string?"
  },
  execute(forge: any, args: any = {}) {
    return forge.memoryProfileGet(args.profileType ?? "identity");
  }
};
