---
name: forge-memory-save
description: |
  Save a durable decision, discovery, preference, or note into ContextForge memory.
  Trigger: /contextforge:forge-memory-save [note]
user-invocable: true
---

# Forge Memory Save

Use ContextForge to save something the assistant should remember later.

## Instructions

1. Treat the command text as the note to save.
2. Call `forge_memory_save` with a concise title and summary.
3. Confirm what was saved and where it will be recalled from.
