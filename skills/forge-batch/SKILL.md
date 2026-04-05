---
name: forge-batch
description: |
  Run shell-heavy research through ContextForge without dumping raw output
  into chat.
  Trigger: /contextforge:forge-batch [request]
user-invocable: true
---

# Forge Batch

Use ContextForge for logs, diffs, tests, and multi-command research.

## Instructions

1. Treat the text after the command as the research request or command set.
2. If the actual commands are missing, ask one concise follow-up question.
3. Call `forge_batch`.
4. Present the compact receipt first:
   - what ran
   - key findings
   - source id if useful
5. Do not replay large raw output unless the user explicitly asks.
6. If the user asks follow-up questions about the same output, prefer `forge_lookup`.
