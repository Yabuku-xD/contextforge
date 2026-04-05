---
name: forge-lookup
description: |
  Search stored ContextForge research output without replaying logs or diffs.
  Trigger: /contextforge:forge-lookup [query]
user-invocable: true
---

# Forge Lookup

Use ContextForge to query stored research results from earlier `forge_batch` runs.

## Instructions

1. Use the text after the command as the lookup query.
2. If no query is provided, ask one concise follow-up question.
3. Call `forge_lookup`.
4. Return only the relevant matches and short explanation.
5. Do not dump the full stored output unless the user explicitly asks.
