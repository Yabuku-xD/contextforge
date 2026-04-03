---
name: forge-bash
description: |
  Run a shell command inside the current repository through ContextForge's
  compact bash tool.
  Trigger: /contextforge:forge-bash [command]
user-invocable: true
---

# Forge Bash

Use ContextForge for compact shell output inside the repository.

## Instructions

1. Use the text after the command as the shell command.
2. If no command is provided, ask one concise follow-up question.
3. Call `forge_bash`.
4. Show the summary first, then include stdout or stderr previews only when they add useful detail.
