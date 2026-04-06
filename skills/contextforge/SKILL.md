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
   - generated architecture/docs artifacts: `forge_map`, `forge_contracts`, or `forge_wiki`
   - repo registry or multi-repo group workflows: `forge_list_repos`, `forge_group_query`, or `forge_group_status`
   - continuity: `forge_resume` or `forge_session`
   - health or diagnostics: `forge_stats` or `forge_doctor`
4. Answer from the ContextForge result first. If the routed tool is `forge_walk` and it returns `exhaustive_walk`, stop tool use for the initial answer and answer from that audit alone. Do not call `forge_read`, `forge_batch`, `forge_lookup`, built-in reads, or any other follow-up tools unless the user explicitly asks for drilldown or the audit says coverage is incomplete.
5. If the request is an edit request, use `forge_search`, `forge_read`, `forge_edit`, `forge_write`, and `forge_impact` before considering fallback tools.

## Signal-based routing shortcuts

ContextForge's `src/router/query-signals.ts` extracts these signals from the request. Use them as a deterministic first pass before applying the prose rules above — it normalizes synonyms (`dir`→`directory`, `pkg`→`package`, `code base`→`codebase`, `sub-folder`→`subfolder`), handles hyphens and plurals, and respects negation / scoped paths.

- `signals.broadDiscovery` → `forge_scan`
- `signals.exhaustive && !signals.negation && signals.scopeHints.length === 0` → `forge_walk`
- `signals.broadRepo && !signals.negation` → `forge_understand`
- `signals.exactSymbol` → `forge_symbol`
- `signals.pinpoint` → `forge_impact`
- `signals.outputHeavy` → `forge_batch`
- otherwise → `forge_search`

This mirrors `recommendForgeTool(signals)` and is the same routing used by the walk-mode helpers, the startup task classifier, the RAPTOR strategy router, and the PreToolUse hook — so behavior stays consistent across the full stack.

Scope guards:
- If the user names an explicit path (`src/foo`, `tests/bar/baz.ts`), treat it as a scoped request and prefer `forge_read` / `forge_search` over exhaustive walks.
- If the user uses a negation (`don't`, `just`, `only`, `except`, `skip`, `ignore`), do not escalate to `forge_walk` even when broad-scope words are present.
