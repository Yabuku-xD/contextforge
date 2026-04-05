export const forgeEditTool = {
  name: "forge_edit",
  description: "Apply an exact text replacement for prompts like `replace this exact string`, `patch this block in place`, or `change this text without opening an editor`, with compact preview output.",
  parameters: {
    path: "string",
    old_text: "string",
    new_text: "string",
    replace_all: "boolean?"
  },
  execute(forge, args = {}) {
    return forge.edit(args.path ?? "", args.old_text ?? "", args.new_text ?? "", {
      replaceAll: args.replace_all
    });
  }
};
