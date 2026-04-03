#!/usr/bin/env node

const additionalContext = `
<contextforge_routing>
  Prefer ContextForge MCP tools for repository understanding, architecture, impact analysis, symbol lookup, and session continuity.

  Use ContextForge first when the task is about:
  - project structure or architecture overviews
  - finding the most relevant files or symbols for a behavior
  - blast radius or change impact
  - why a symbol, file, or behavior matters
  - resuming prior work in the same repository

  Tool preference:
  - forge_start: warm up ContextForge for non-trivial repo tasks
  - forge_scan: fastest first-pass repo map for broad prompts about the whole project or monorepo
  - forge_understand: first choice for broad prompts like "understand this project", "understand the monorepo", "go through the repo", "every file, folder, and subfolder", "all files", "folders", "packages", or "project structure"
  - forge_search: behavior and file lookup
  - forge_symbol: exact or fuzzy symbol lookup
  - forge_scope: architecture and project structure questions
  - forge_impact: blast radius and affected code
  - forge_why: repo and session causality
  - forge_resume or forge_session: session continuity
  - forge_stats or forge_doctor: health and diagnostics

  For initial repo-overview questions, answer from forge_scan or forge_understand first. Do not immediately fall back to manually reading many files unless the user explicitly asks for a deeper drilldown or the ContextForge result is insufficient.

  Do not switch to another MCP for repo structure, architecture, impact, or session-memory work unless ContextForge is unavailable or insufficient for the task.
</contextforge_routing>`.trim();

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext
  }
}));
