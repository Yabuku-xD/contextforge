export const forgeDoctorTool = {
  name: "forge_doctor",
  description: "Diagnose ContextForge installation and repository state.",
  parameters: {},
  execute(forge) {
    return forge.doctor();
  }
};
