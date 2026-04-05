---
name: forge-changes
description: |
  Map git changes to symbols, files, and likely impact areas.
  Trigger: /contextforge:forge-changes [optional scope]
user-invocable: true
---

# Forge Changes

Use ContextForge to explain the current diff in repo terms.

## Instructions

1. Use the text after the command as the scope or diff request. If no text is provided, use: `summarize the current changes`.
2. Call `forge_start` when useful.
3. Call `forge_changes`.
4. Present:
   - changed files or areas
   - mapped symbols if available
   - likely impact or follow-up risks
