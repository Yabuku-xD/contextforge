---
name: forge-memory-status
description: |
  Show ContextForge's durable memory stack, counts, and wake-up readiness.
  Trigger: /contextforge:forge-memory-status
user-invocable: true
---

# Forge Memory Status

Use ContextForge to inspect long-term memory health and layer counts.

## Instructions

1. Call `forge_memory_status`.
2. Summarize:
   - whether global memory is enabled
   - profile availability
   - entry, diary, fact, and checkpoint counts
   - whether `forge_memory_wakeup` is the right next step
