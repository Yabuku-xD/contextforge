---
name: forge-memory-recall
description: |
  Recall scoped memory for a topic, area, or room inside the current repo.
  Trigger: /contextforge:forge-memory-recall [query]
user-invocable: true
---

# Forge Memory Recall

Use ContextForge to load topic-scoped durable memory without doing a deep search first.

## Instructions

1. Use the text after the command as the recall query. If there is no text, recall recent memory for the current repo.
2. Call `forge_memory_recall`.
3. Return the most relevant entries and keep the first answer brief.
