export const forgeResumeTool = {
  name: "forge_resume",
  description: "Build a compact resume summary for the current session.",
  parameters: {},
  execute(forge) {
    return forge.resume();
  }
};
