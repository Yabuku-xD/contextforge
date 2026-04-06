export const forgeRenameTool = {
  name: "forge_rename",
  description: "Preview or apply a coordinated rename for prompts like `rename this symbol`, `rename this API across the repo`, or `what files would this rename touch`.",
  parameters: {
    symbol_query: "string",
    new_name: "string",
    dry_run: "boolean?"
  },
  execute(forge: any, args: any = {}) {
    return forge.rename(args.symbol_query ?? "", args.new_name ?? "", {
      dryRun: args.dry_run
    });
  }
};
