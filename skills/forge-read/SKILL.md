---
name: forge-read
description: |
  Read a file excerpt or list a directory inside the current repository
  using ContextForge's compact file-op tool.
  Trigger: /contextforge:forge-read [path]
user-invocable: true
---

# Forge Read

Use ContextForge for compact repository reads.

## Instructions

1. Use the text after the command as the path or read request.
2. If no path is provided, ask one concise follow-up question.
3. If the user includes line numbers or a range, pass them to `forge_read`.
4. Call `forge_read`.
5. Show the returned excerpt or directory listing directly, then add a one-line explanation only if useful.
