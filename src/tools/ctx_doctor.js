export const ctxDoctor = {
  name: "ctx_doctor",
  description: "Diagnose ContextForge installation and repository state.",
  parameters: {},
  execute(forge) {
    return forge.doctor();
  }
};
