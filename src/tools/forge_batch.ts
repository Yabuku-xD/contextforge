export const forgeBatchTool = {
  name: "forge_batch",
  description: "Run one or more repo-local commands for prompts like `run tests and summarize`, `inspect logs`, `show git diff without flooding chat`, `check CI output`, or `collect command output then let me ask follow-up questions`; keep full output in ContextForge's local research index and return a compact receipt.",
  parameters: {
    commands: "string[]",
    queries: "string[]?",
    cwd: "string?",
    label: "string?",
    timeout_ms: "number?",
    max_chars: "number?"
  },
  async execute(forge: any, args: any = {}) {
    return forge.batch(args.commands, {
      queries: args.queries,
      cwd: args.cwd,
      label: args.label,
      timeoutMs: args.timeout_ms,
      maxChars: args.max_chars
    });
  }
};
