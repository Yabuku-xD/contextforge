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
   - the coverage verdict
   - whether indexed memory is complete or still warming
   - the top-level architecture
   - the major areas
   - the key entrypoints and important files
5. Keep the first answer receipt-first and compact. Avoid long tables unless the user explicitly asks for them.
6. If `forge_walk` returns `exhaustive_walk`, stop there for the initial response. Do not call `forge_read`, `forge_batch`, `forge_lookup`, `forge_search`, built-in reads, or any other follow-up tools unless the user explicitly asks for a deeper drilldown or ContextForge reports incomplete coverage.
