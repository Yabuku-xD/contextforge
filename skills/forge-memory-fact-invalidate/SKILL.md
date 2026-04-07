---
name: forge-memory-fact-invalidate
description: |
  Invalidate a remembered fact when it is no longer true.
  Trigger: /contextforge:forge-memory-fact-invalidate [fact]
user-invocable: true
---

# Forge Memory Fact Invalidate

Use ContextForge when a previously remembered fact should be retired.

## Instructions

1. Interpret the command text as the fact to end.
2. Call `forge_memory_fact_invalidate`.
3. Report how many active facts were invalidated.
