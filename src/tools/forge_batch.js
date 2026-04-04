export const forgeBatchTool = {
  name: "forge_batch",
  description: "Run one or more shell commands inside the current repository, keep the full output in ContextForge's local research index, and return only a compact receipt plus optional query matches.",
  parameters: {
    commands: "string[]",
    queries: "string[]?",
    cwd: "string?",
    label: "string?",
    timeout_ms: "number?",
    max_chars: "number?"
  },
  async execute(forge, args = {}) {
    return forge.batch(args.commands, {
      queries: args.queries,
      cwd: args.cwd,
      label: args.label,
      timeoutMs: args.timeout_ms,
      maxChars: args.max_chars
    });
  }
};
