---
name: forge-search
description: |
  Search the repository with ContextForge for behaviors, files, symbols,
  or architecture-related queries.
  Trigger: /contextforge:forge-search [query]
user-invocable: true
---

# Forge Search

Use ContextForge to find the most relevant code and files quickly.

## Instructions

1. Use the text after the command as the search query.
2. If no query is provided, ask one concise follow-up question.
3. Call `forge_start` when the task is non-trivial.
4. Call `forge_search` with the query and `limit: 8`.
5. Present the top matches with:
   - label or symbol
   - file path
   - why it matched
6. Only read files manually if the user asks to drill into one of the search results.
