export const forgeBashTool = {
  name: "forge_bash",
  description: "Run a compact repo-local shell command for prompts like `run git status here`, `execute this command in the repo`, or `show me a small command result` when the output should stay short.",
  parameters: {
    command: "string",
    cwd: "string?",
    timeout_ms: "number?",
    max_chars: "number?"
  },
  async execute(forge: any, args: any = {}) {
    return forge.bash(args.command ?? "", {
      cwd: args.cwd,
      timeoutMs: args.timeout_ms,
      maxChars: args.max_chars
    });
  }
};
