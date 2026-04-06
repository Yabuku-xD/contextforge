export const forgeScopeTool = {
  name: "forge_scope",
  description: "Architecture and relationship lookup for prompts like `how is this project structured`, `which modules talk to each other`, `show the flow between areas`, or `explain the high-level scope of X`.",
  parameters: { query: "string", mode: "auto | collapsed | traversal ?" },
  execute(forge: any, args: any = {}) {
    return forge.scope(args.query ?? "", normalizeMode(args.mode));
  }
};

function normalizeMode(mode) {
  if (mode === "collapsed" || mode === "traversal" || mode === "auto") {
    return mode;
  }
  return "auto";
}
