export const forgeBashTool = {
  name: "forge_bash",
  description: "Run a shell command inside the current repository with compact stdout and stderr previews.",
  parameters: {
    command: "string",
    cwd: "string?",
    timeout_ms: "number?",
    max_chars: "number?"
  },
  async execute(forge, args = {}) {
    return forge.bash(args.command ?? "", {
      cwd: args.cwd,
      timeoutMs: args.timeout_ms,
      maxChars: args.max_chars
    });
  }
};
