export const forgeWriteTool = {
  name: "forge_write",
  description: "Create or overwrite a file for prompts like `create this file`, `write this content`, or `replace the full file contents` inside the current repository.",
  parameters: {
    path: "string",
    content: "string",
    create_dirs: "boolean?"
  },
  execute(forge, args = {}) {
    return forge.write(args.path ?? "", args.content ?? "", {
      createDirs: args.create_dirs
    });
  }
};
