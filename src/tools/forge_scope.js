export const forgeScopeTool = {
  name: "forge_scope",
  description: "RAPTOR-backed broad architecture lookup.",
  parameters: { query: "string", mode: "auto | collapsed | traversal ?" },
  execute(forge, args = {}) {
    return forge.scope(args.query ?? "", normalizeMode(args.mode));
  }
};

function normalizeMode(mode) {
  if (mode === "collapsed" || mode === "traversal" || mode === "auto") {
    return mode;
  }
  return "auto";
}
