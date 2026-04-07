import { classifyTask } from "../router/classify-task.js";

export function classifyStartup(message): any {
  const task = classifyTask(message);
  return {
    ...task,
    loadStrategy: task.label === "trivial"
      ? "minimal"
      : task.label === "simple"
        ? "light"
        : "full"
  };
}
