export const forgeReadTool = {
  name: "forge_read",
  description: "Read a file excerpt or list a directory for prompts like `show me this file`, `open this path`, `list this folder`, or `read lines 20-80`, with compact output.",
  parameters: {
    path: "string",
    start_line: "number?",
    end_line: "number?",
    max_lines: "number?",
    limit: "number?"
  },
  execute(forge: any, args: any = {}) {
    return forge.read(args.path ?? "", {
      startLine: args.start_line,
      endLine: args.end_line,
      maxLines: args.max_lines,
      limit: args.limit
    });
  }
};
