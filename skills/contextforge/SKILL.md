---
name: contextforge
description: |
  General ContextForge command router for repository understanding, search,
  impact analysis, continuity, and repo-aware editing.
  Trigger: /contextforge:contextforge [request]
user-invocable: true
---

# ContextForge Router

Use ContextForge as the first stop for repository context work.

## Instructions

1. Treat any text after the command as the user request.
2. For non-trivial repository tasks, call `forge_start` first with that request.
3. Route the request to the best ContextForge tool:
   - broad repo overview or architecture: `forge_understand`
   - exhaustive whole-project walkthrough: `forge_walk`
   - compact file read or directory listing: `forge_read`
   - create or overwrite a file: `forge_write`
   - exact in-file replacement: `forge_edit`
   - compact shell execution: `forge_bash`
   - search for files, symbols, or behaviors: `forge_search`
   - exact symbol targeting: `forge_symbol`
   - blast radius: `forge_impact`
   - causality or repo/session reasoning: `forge_why`
   - continuity: `forge_resume`
   - health or diagnostics: `forge_stats` or `forge_doctor`
4. Answer from the ContextForge result first. Do not jump to heavier built-in tool paths unless the user explicitly asks for them or the ContextForge result is clearly insufficient.
5. If the request is an edit request, use `forge_search`, `forge_read`, `forge_edit`, `forge_write`, and `forge_impact` before considering fallback tools.
