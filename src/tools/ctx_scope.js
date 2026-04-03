export const ctxScope = {
  name: "forge_scope",
  description: "RAPTOR-backed broad architecture lookup.",
  parameters: { query: "string", mode: "auto | collapsed | traversal ?" },
  execute(forge, args = {}) {
    return forge.scope(args.query ?? "", args.mode ?? "auto");
  }
};
