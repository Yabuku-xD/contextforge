export const ctxWrite = {
  name: "forge_write",
  description: "Create or overwrite a file inside the current repository.",
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
