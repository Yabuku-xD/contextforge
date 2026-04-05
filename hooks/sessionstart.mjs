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
  - forge_start: warm up ContextForge for non-trivial repo tasks and establish paging/session state. On large repositories it may queue the eager full-repository prime in the background so it can return quickly
  - forge_batch: first choice for shell-heavy research, logs, test output, git diff/log, or multi-command discovery when raw output would otherwise flood chat
  - forge_lookup: search the stored output from prior forge_batch runs without replaying raw logs into chat
  - forge_scan: fastest first-pass repo map for broad prompts about the whole project or monorepo
  - forge_understand: first choice for broad prompts like "understand this project", "understand the monorepo", "go through the repo", "all files", "folders", "packages", or "project structure". It auto-escalates for exhaustive prompts.
  - forge_walk: use for exhaustive whole-project prompts like "every file, folder, and subfolder", "walk the repo", or "go through each package/module". For explicit all-files requests it opens every repository file locally, reads text bodies, scans binary assets, and returns a compact repo digest before manual reads
  - forge_read: compact file excerpt or directory listing inside the current repo
  - forge_write: create or overwrite a file inside the current repo
  - forge_edit: exact text replacement with compact preview
  - forge_bash: compact shell execution inside the current repo
  - forge_search: behavior and file lookup
  - forge_symbol: exact or fuzzy symbol lookup
  - forge_scope: architecture and project structure questions
  - forge_impact: blast radius and affected code
  - forge_why: repo and session causality
  - forge_resume or forge_session: session continuity
  - forge_stats or forge_doctor: health and diagnostics

  At session start, treat forge_start as the prime step: it should prepare ContextForge immediately and may queue the full eager index in the background on large repositories so the first MCP call does not time out. A queued startup prime is normal, not a failure. For initial repo-overview questions, answer from forge_scan, forge_understand, or forge_walk first. Keep the first whole-repo answer compact: coverage verdict, top-level architecture, major areas, key entrypoints, and a short next-step suggestion. Avoid long tables unless the user explicitly asks for them. If the task is shell-heavy, log-heavy, or likely to return large command output, prefer forge_batch first and use forge_lookup for follow-up questions. If the user asks for every file or the whole repo exhaustively, treat forge_walk's audit as the authoritative first pass, answer from it before spawning Explore agents, and if the user asks "did you read every file?", "did you read the whole project?", or "did you read every corner of the files?" answer yes when forge_walk reports exhaustive coverage. Only then add the nuance that the chat answer is compact and not every line is retained verbatim in active message memory. After a successful exhaustive forge_walk, do not manually open representative files, key entrypoints, or additional package files for the initial answer. The audit is already complete enough for the first response. Only drill down afterward if the user explicitly asks for deeper detail or ContextForge reports incomplete coverage. For targeted file reads, exact edits, file writes, or shell commands that stay inside the repo, prefer forge_read, forge_edit, forge_write, or forge_bash before reaching for heavier built-in tool paths. Staying on the ContextForge path reduces extra permission prompts because these repo-native tools are intended to be pre-approved at install time. Do not immediately fall back to manually reading many files or spawning Explore agents unless the user explicitly asks for a deeper drilldown or the ContextForge result is insufficient.

  Do not switch to another MCP for repo structure, architecture, impact, or session-memory work unless ContextForge is unavailable or insufficient for the task.
</contextforge_routing>`.trim();

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext
  }
}));
