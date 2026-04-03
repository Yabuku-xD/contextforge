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
   - search for files, symbols, or behaviors: `forge_search`
   - exact symbol targeting: `forge_symbol`
   - blast radius: `forge_impact`
   - causality or repo/session reasoning: `forge_why`
   - continuity: `forge_resume`
   - health or diagnostics: `forge_stats` or `forge_doctor`
4. Answer from the ContextForge result first. Do not jump to manual file crawling unless the user explicitly asks for deeper inspection or the ContextForge result is clearly insufficient.
5. If the request is an edit request, use ContextForge to narrow the file set first, then use Claude's built-in read/edit/write tools for the actual changes.
