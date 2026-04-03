---
name: forge-edit
description: |
  Repo-aware edit workflow: use ContextForge to narrow the right files,
  then use ContextForge-native file operations to make the change.
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
   - `forge_read` for targeted file excerpts
5. Use `forge_edit` for exact replacements and `forge_write` for full file creation or overwrite when the task fits those operations.
6. Keep reads and edits targeted. Do not brute-force the whole repository if ContextForge already identified the relevant areas.
7. Only fall back to heavier built-in tool paths if the requested mutation cannot be expressed cleanly with ContextForge's native file-op tools.
8. After editing, summarize what changed and why.
