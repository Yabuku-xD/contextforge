export const forgeDoctorTool = {
  name: "forge_doctor",
  description: "Diagnose ContextForge for prompts like `why is ContextForge not working`, `check plugin health`, `why is the index stuck`, or `verify installation and repo state`.",
  parameters: {},
  execute(forge) {
    return forge.doctor();
  }
};
