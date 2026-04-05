---
name: forge-scan
description: |
  Get a fast first-pass map of the current repository.
  Trigger: /contextforge:forge-scan [optional request]
user-invocable: true
---

# Forge Scan

Use ContextForge for the quickest repo overview.

## Instructions

1. Use the text after the command as the query. If no text is provided, use: `give me a quick overview of this repository`.
2. Call `forge_start` when the task is non-trivial.
3. Call `forge_scan`.
4. Keep the answer compact:
   - summary
   - top-level areas
   - likely entrypoints
   - where to drill next if useful
