export const ctxRead = {
  name: "forge_read",
  description: "Read a file excerpt or list a directory inside the current repository with compact output.",
  parameters: {
    path: "string",
    start_line: "number?",
    end_line: "number?",
    max_lines: "number?",
    limit: "number?"
  },
  execute(forge, args = {}) {
    return forge.read(args.path ?? "", {
      startLine: args.start_line,
      endLine: args.end_line,
      maxLines: args.max_lines,
      limit: args.limit
    });
  }
};
