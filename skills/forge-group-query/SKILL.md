---
name: forge-group-query
description: |
  Search across repositories in a named ContextForge group.
  Trigger: /contextforge:forge-group-query [request]
user-invocable: true
---

# Forge Group Query

Use ContextForge to search a named multi-repo group.

## Instructions

1. Treat the text after the command as the group query request.
2. If the group name or query is missing, ask one concise follow-up question.
3. Call `forge_group_query`.
4. Present the top cross-repo matches compactly.
