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
  - durable memory, prior decisions, project history, or remembered facts

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
  - forge_changes: map git changes or diffs to files, symbols, and likely impact
  - forge_rename: coordinated repo-aware rename preview or apply
  - forge_why: repo and session causality
  - forge_map, forge_contracts, forge_wiki: generate architecture or documentation artifacts from the index
  - forge_list_repos, forge_group_query, forge_group_status: multi-repo registry and group workflows
  - forge_resume or forge_session: session continuity
  - forge_memory_status: show the long-term memory stack, counts, and layer availability
  - forge_memory_wakeup: load the compact wake-up capsule before assuming prior decisions, identity, or project history
  - forge_memory_recall: scoped topic recall for the current repo, hall, or room
  - forge_memory_search: deep-search memory entries, diaries, and remembered facts
  - forge_memory_save: save durable discoveries, decisions, and preferences
  - forge_memory_profile_set / forge_memory_profile_get: set or inspect identity/project memory profiles
  - forge_memory_diary_write / forge_memory_diary_read: write or read diary/checkpoint notes
  - forge_memory_fact_add / forge_memory_fact_invalidate / forge_memory_fact_query / forge_memory_timeline: manage temporal facts and timelines
  - forge_stats or forge_doctor: health and diagnostics

  Prompt routing examples:
  - "why does this file matter", "what is this for", "why is this important": forge_why
  - "what breaks if I change X", "who depends on this", "what else is affected": forge_impact
  - "what changed on this branch", "summarize the diff", "map these changes": forge_changes
  - "rename this symbol", "rename this API across the repo": forge_rename
  - "where is function/class X", "find symbol Foo": forge_symbol
  - "find where behavior Y is implemented", "which file handles Z": forge_search
  - "how is this area structured", "which modules talk to each other": forge_scope
  - "run tests and summarize", "inspect these logs", "show git diff without flooding chat": forge_batch
  - "search the saved logs from earlier", "find the error in that stored output": forge_lookup
  - "make me a repo map", "generate the repo wiki", "show integration contracts": forge_map, forge_wiki, forge_contracts
  - "what repos are registered", "search across grouped repos": forge_list_repos, forge_group_query, forge_group_status
  - "what should you remember before we continue", "load prior decisions", "wake up memory": forge_memory_wakeup
  - "remember this", "save this decision", "store this long-term": forge_memory_save
  - "what do you remember about X", "search remembered notes", "verify this remembered fact": forge_memory_search or forge_memory_fact_query
  - "timeline of X", "what changed over time": forge_memory_timeline

  At session start, treat forge_start as the prime step: it should prepare ContextForge immediately and may queue the full eager index in the background on large repositories so the first MCP call does not time out. A queued startup prime is normal, not a failure. For initial repo-overview questions, answer from forge_scan, forge_understand, or forge_walk first. Before guessing about prior decisions, long-term preferences, or remembered project history, load forge_memory_wakeup or forge_memory_status. Keep the first whole-repo answer compact: coverage verdict, top-level architecture, major areas, key entrypoints, and a short next-step suggestion. Avoid long tables unless the user explicitly asks for them. If the task is shell-heavy, log-heavy, or likely to return large command output, prefer forge_batch first and use forge_lookup for follow-up questions. If the user asks for every file or the whole repo exhaustively, treat forge_walk's audit as the authoritative first pass, answer from it before spawning Explore agents, and if the user asks "did you read every file?", "did you read the whole project?", or "did you read every corner of the files?" answer yes when forge_walk reports exhaustive coverage. Only then add the nuance that the chat answer is compact and not every line is retained verbatim in active message memory. After a successful exhaustive forge_walk, stop tool use for the initial answer. Do not call forge_read, forge_batch, forge_lookup, forge_search, built-in Read, built-in Bash, or built-in Grep for the first response. The audit is already complete enough. Only drill down afterward if the user explicitly asks for deeper detail or ContextForge reports incomplete coverage. For targeted file reads, exact edits, file writes, or shell commands that stay inside the repo, prefer forge_read, forge_edit, forge_write, or forge_bash before reaching for heavier built-in tool paths. Staying on the ContextForge path reduces extra permission prompts because these repo-native tools are intended to be pre-approved at install time. Do not immediately fall back to manually reading many files or spawning Explore agents unless the user explicitly asks for a deeper drilldown or the ContextForge result is insufficient.

  Do not switch to another MCP for repo structure, architecture, impact, or session-memory work unless ContextForge is unavailable or insufficient for the task.
</contextforge_routing>`.trim();

console.log(JSON.stringify({
  continue: true,
  suppressOutput: false,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext
  }
}));
