---
name: forge-rename
description: |
  Preview or apply a coordinated repository rename.
  Trigger: /contextforge:forge-rename [request]
user-invocable: true
---

# Forge Rename

Use ContextForge for repo-aware rename work.

## Instructions

1. Treat the text after the command as the rename request.
2. If the current name or new name is missing, ask one concise follow-up question.
3. Call `forge_start` when useful.
4. Call `forge_rename`, preferring dry-run first unless the user explicitly asks to apply it now.
5. Present the impacted files and symbols before applying changes.
