export const forgeRenameTool = {
  name: "forge_rename",
  description: "Preview or apply a coordinated repository rename using graph context plus text search.",
  parameters: {
    symbol_query: "string",
    new_name: "string",
    dry_run: "boolean?"
  },
  execute(forge, args = {}) {
    return forge.rename(args.symbol_query ?? "", args.new_name ?? "", {
      dryRun: args.dry_run
    });
  }
};
