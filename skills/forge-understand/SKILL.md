---
name: forge-understand
description: |
  Understand the current repository or monorepo with ContextForge.
  Best for architecture, top-level folders, packages, entrypoints,
  and important files.
  Trigger: /contextforge:forge-understand [optional request]
user-invocable: true
---

# Forge Understand

Use ContextForge to produce a broad repository understanding pass.

## Instructions

1. Use the text after the command as the query. If no text is provided, use: `understand this repository and explain its structure`.
2. Call `forge_start` with the query when the task is non-trivial.
3. Call `forge_understand` with the query.
4. Present:
   - the summary
   - the most important top-level areas
   - likely entrypoints
   - the most important files to read first
5. Do not manually read many files unless the user explicitly asks for a deeper drilldown.
