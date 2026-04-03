---
name: forge-edit
description: |
  Repo-aware edit workflow: use ContextForge to narrow the right files,
  then use Claude's built-in file tools to make the change.
  Trigger: /contextforge:forge-edit [change request]
user-invocable: true
---

# Forge Edit

Use ContextForge as the front-end for targeted code changes.

## Instructions

1. Treat the text after the command as the change request.
2. If the request is ambiguous, ask one concise clarifying question.
3. Call `forge_start` with the change request.
4. Use one or more ContextForge tools to narrow the edit scope:
   - `forge_search` for behavior or file discovery
   - `forge_symbol` for exact targets
   - `forge_impact` for blast radius
   - `forge_understand` or `forge_walk` for larger refactors
5. Once the likely files are identified, use Claude's built-in file tools to read, create, edit, or write files.
6. Keep manual file reads targeted. Do not brute-force the whole repository if ContextForge already identified the relevant areas.
7. After editing, summarize what changed and why.
