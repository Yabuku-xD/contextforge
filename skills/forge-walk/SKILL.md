---
name: forge-walk
description: |
  Do a deeper package-by-package and folder-by-folder repository walk
  with ContextForge.
  Trigger: /contextforge:forge-walk [optional request]
user-invocable: true
---

# Forge Walk

Use ContextForge's deeper repo map for exhaustive repository prompts.

## Instructions

1. Use the text after the command as the query. If no text is provided, use: `go through every file, folder, and subfolder in this repository and explain what each major area does`.
2. Call `forge_start` with the query when the task is non-trivial.
3. Call `forge_walk` with the query.
4. Present:
   - the summary
   - top-level areas
   - package sections
   - directory sections
   - representative files for each major area
5. Answer from the walk result first. Do not immediately spawn subagents or manually inspect dozens of files unless the user asks for deeper detail.
