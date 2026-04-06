export const forgeResumeTool = {
  name: "forge_resume",
  description: "Build a compact resume summary for prompts like `resume where we left off`, `what were we doing`, or `catch me up on this repo session`.",
  parameters: {},
  execute(forge) {
    return forge.resume();
  }
};
