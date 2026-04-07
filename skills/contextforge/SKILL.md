---
name: contextforge
description: |
  General ContextForge command router for repository understanding, search,
  impact analysis, continuity, durable memory, and repo-aware editing.
  Trigger: /contextforge:contextforge [request]
user-invocable: true
---

# ContextForge Router

Use ContextForge as the first stop for repository context work.

## Instructions

1. Treat any text after the command as the user request.
2. For non-trivial repository tasks, call `forge_start` first with that request.
3. Route the request to the best ContextForge tool:
   - quick repo overview, top-level folders, or where to start: `forge_scan`
   - broad repo overview, architecture, important files, or what the project does: `forge_understand`
   - exhaustive whole-project walkthrough or every-file request: `forge_walk`
   - compact file read or directory listing: `forge_read`
   - create or overwrite a file: `forge_write`
   - exact in-file replacement: `forge_edit`
   - compact shell execution with small output: `forge_bash`
   - shell-heavy research, tests, diffs, or logs: `forge_batch`
   - search stored batch output from earlier: `forge_lookup`
   - search for files, behaviors, or code paths: `forge_search`
   - exact symbol targeting: `forge_symbol`
   - broad architecture or area relationships: `forge_scope`
   - blast radius or what breaks if X changes: `forge_impact`
   - git-aware change mapping or current diff summary: `forge_changes`
   - coordinated rename preview or apply: `forge_rename`
   - why a file, symbol, or behavior matters: `forge_why`
   - long-term memory status or wake-up context: `forge_memory_status` or `forge_memory_wakeup`
   - scoped memory recall, topology navigation, or deep remembered search: `forge_memory_recall`, `forge_memory_navigate`, or `forge_memory_search`
   - save durable decisions, discoveries, or preferences: `forge_memory_save`
   - set or inspect identity/project profiles: `forge_memory_profile_set` or `forge_memory_profile_get`
   - write or read diary checkpoints: `forge_memory_diary_write` or `forge_memory_diary_read`
   - manage remembered facts and timelines: `forge_memory_fact_add`, `forge_memory_fact_invalidate`, `forge_memory_fact_query`, or `forge_memory_timeline`
   - generated architecture/docs artifacts: `forge_map`, `forge_contracts`, or `forge_wiki`
   - repo registry or multi-repo group workflows: `forge_list_repos`, `forge_group_query`, or `forge_group_status`
   - continuity: `forge_resume` or `forge_session`
   - health or diagnostics: `forge_stats` or `forge_doctor`
4. Answer from the ContextForge result first. If the routed tool is `forge_walk` and it returns `exhaustive_walk`, stop tool use for the initial answer and answer from that audit alone. Do not call `forge_read`, `forge_batch`, `forge_lookup`, built-in reads, or any other follow-up tools unless the user explicitly asks for drilldown or the audit says coverage is incomplete.
5. If the request is an edit request, use `forge_search`, `forge_read`, `forge_edit`, `forge_write`, and `forge_impact` before considering fallback tools.
6. If the request depends on prior decisions, personal/project history, or remembered facts, load `forge_memory_wakeup` or `forge_memory_status` before guessing.

## Signal-based routing shortcuts

ContextForge's `src/router/query-signals.ts` extracts these signals from the request. Use them as a deterministic first pass before applying the prose rules above — it normalizes synonyms (`dir`→`directory`, `pkg`→`package`, `code base`→`codebase`, `sub-folder`→`subfolder`), handles hyphens and plurals, and respects negation / scoped paths.

- `signals.broadDiscovery` → `forge_scan`
- `signals.intentResume` → `forge_resume`
- `signals.intentMemorySave` → `forge_memory_save`
- `signals.intentMemoryWakeup` → `forge_memory_wakeup`
- `signals.intentMemoryNavigate` → `forge_memory_navigate`
- `signals.intentMemoryTimeline` → `forge_memory_timeline`
- `signals.intentMemorySearch` → `forge_memory_search`
- `signals.intentLookup` → `forge_lookup`
- `signals.intentMap` / `signals.intentWiki` / `signals.intentContracts` → `forge_map` / `forge_wiki` / `forge_contracts`
- `signals.intentListRepos` / `signals.intentGroupQuery` / `signals.intentGroupStatus` → `forge_list_repos` / `forge_group_query` / `forge_group_status`
- `signals.exhaustive && !signals.negation && signals.scopeHints.length === 0` → `forge_walk`
- `signals.broadRepo && !signals.negation` → `forge_understand`
- `signals.intentRename` → `forge_rename`
- `signals.intentChanges` → `forge_changes`
- `signals.intentWhy` → `forge_why`
- `signals.intentImpact` → `forge_impact`
- `signals.exactSymbol` → `forge_symbol`
- `signals.intentScope` → `forge_scope`
- `signals.intentWrite` / `signals.intentEdit` / `signals.intentRead` → `forge_write` / `forge_edit` / `forge_read`
- `signals.shellIntent && !signals.outputHeavy` → `forge_bash`
- `signals.pinpoint` → `forge_impact`
- `signals.outputHeavy` → `forge_batch`
- otherwise → `forge_search`

Memory routing:
- "remember this", "save this decision", "store this long-term" → `forge_memory_save`
- "what should you remember", "wake up memory", "load prior decisions" → `forge_memory_wakeup`
- "what does the memory map look like", "show the memory rooms", "navigate project memory" → `forge_memory_navigate`
- "what do you remember about X", "search remembered notes", "verify this remembered fact" → `forge_memory_search` or `forge_memory_fact_query`
- "timeline of X", "what changed over time" → `forge_memory_timeline`

Broader natural-language cues:
- "what touched this branch", "what did this commit change", "review these modifications" → `forge_changes`
- "what’s this file doing here", "what role does this module play", "why do we have this" → `forge_why`
- "what depends on this", "what else will this break", "show downstream fallout" → `forge_impact`
- "open package.json", "show src/foo.ts", "read the README", "list this directory" → `forge_read`
- "replace this exact block in src/foo.ts", "patch this string in place" → `forge_edit`
- "create docs/notes.md", "overwrite this file with the new content" → `forge_write`
- "run git status", "execute pwd here", "run this small repo command" → `forge_bash`
- "continue where we left off", "pick up the previous session" → `forge_resume`

This mirrors `recommendForgeTool(signals)` and is the same routing used by the walk-mode helpers, the startup task classifier, the RAPTOR strategy router, and the PreToolUse hook — so behavior stays consistent across the full stack.

Scope guards:
- If the user names an explicit path (`src/foo`, `tests/bar/baz.ts`), treat it as a scoped request and prefer `forge_read` / `forge_search` over exhaustive walks.
- If the user uses a negation (`don't`, `just`, `only`, `except`, `skip`, `ignore`), do not escalate to `forge_walk` even when broad-scope words are present.
