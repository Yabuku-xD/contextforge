---
name: forge-symbol
description: |
  Find exact or fuzzy symbols in the current repository.
  Trigger: /contextforge:forge-symbol [query]
user-invocable: true
---

# Forge Symbol

Use ContextForge for symbol-level targeting.

## Instructions

1. Use the text after the command as the symbol query.
2. If no query is provided, ask one concise follow-up question.
3. Call `forge_start` when the request is non-trivial.
4. Call `forge_symbol`.
5. Present the best matches with:
   - symbol label
   - file path
   - why it is likely the right target
