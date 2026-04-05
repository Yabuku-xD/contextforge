---
name: forge-start
description: |
  Warm ContextForge for the current repository and report index readiness.
  Trigger: /contextforge:forge-start [optional request]
user-invocable: true
---

# Forge Start

Use ContextForge to warm the repo context and report startup status.

## Instructions

1. Use the text after the command as the startup query. If no text is provided, use: `prepare ContextForge for this repository task`.
2. Call `forge_start`.
3. Present the warm-up status briefly:
   - `index.status`
   - `index.indexStatus`
   - `indexedFileCount/filesTotal`
4. If startup is queued or warming, say that is normal rather than treating it as failure.
