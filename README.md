<div align="center">

<a id="readme"></a>

<h1>ContextForge</h1>

<p><strong>Claude-first repository intelligence for low-context coding workflows.</strong></p>

<p>
  ContextForge gives Claude Code a stronger operating layer for large repositories:
  repository understanding, graph-aware retrieval, impact analysis, compact research,
  session continuity, durable long-term memory, and repo-native file operations that do not flood the chat window.
</p>

[![Release](https://img.shields.io/badge/release-v0.1.52-C2410C?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge/releases)
[![License](https://img.shields.io/badge/license-MIT-166534?style=for-the-badge)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22.5%2B-2563EB?style=for-the-badge)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/claude%20code-marketplace-4B5563?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)
[![GitHub Stars](https://img.shields.io/github/stars/Yabuku-xD/contextforge?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)

</div>

<a id="table-of-contents"></a>
## Table of Contents

- [What It Is](#what-it-is)
- [Why It Helps](#why-it-helps)
- [Core Capabilities](#core-capabilities)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [Usage](#usage)
- [Automatic Routing](#automatic-routing)
- [Command Reference](#command-reference)
- [Tool Families](#tool-families)
- [Documentation](#documentation)
- [License](#license)

<a id="what-it-is"></a>
## What It Is

ContextForge is an open-source MCP server, CLI, and Claude Code marketplace plugin that helps Claude stay oriented in real repositories. Instead of treating each prompt like a fresh crawl, it builds and reuses a local index of repository structure, symbols, graph edges, session events, research output, and a separate durable memory layer for long-term facts, diaries, and wake-up capsules.

That lets Claude answer broad repository questions with compact receipts, trace changes through indexed graph relationships, keep large shell output out of chat, and operate on files inside the repo without constantly falling back to noisy manual exploration.

The source tree now lives in `src/**/*.ts`, the hooks/tests/plugin bootstrap are TypeScript too, and the repo now passes a real `npm run typecheck` instead of relying on a transpile-only migration. The runnable CLI, MCP server, hooks, and tests are emitted under `dist/` during `npm install` / `npm run build`.

[⬆ back to top](#readme)

<a id="why-it-helps"></a>
## Why It Helps

- Reduces chat-window waste by returning compact repo digests instead of replaying broad manual crawls.
- Gives Claude better repo memory through a persistent local index with full text-body coverage and line counts.
- Improves targeting for search, symbol lookup, architecture questions, blast-radius analysis, and git change mapping.
- Routes natural-language prompts like “what touched this branch”, “what role does this file play”, “show me src/foo.ts”, or “continue where we left off” onto the right `forge_*` tool more reliably.
- Adds a low-context research lane with `forge_batch` and `forge_lookup` so logs, diffs, and command output stay indexed locally.
- Adds a Mempalace-style layered memory stack with wake-up capsules, scoped recall, wing/hall/room navigation, diary checkpoints, temporal facts, and provenance-weighted hybrid retrieval across sessions.
- Provides repo-native `forge_read`, `forge_write`, `forge_edit`, and `forge_bash` operations for smaller, more controlled tool output.
- Supports multi-repo workflows with a registry, repo groups, graph summaries, generated artifacts, and MCP resources.

[⬆ back to top](#readme)

<a id="core-capabilities"></a>
## Core Capabilities

### Repository Understanding

- `forge_start` warms ContextForge and reports index progress.
- `forge_scan`, `forge_understand`, and `forge_walk` answer broad repo questions from inventory, audit, and indexed memory.
- Exhaustive walk mode can open every repository file locally, read text bodies, scan binaries, and return a compact audit-backed summary.

### Graph and Architecture

- Derived graph areas, flows, and schema summaries.
- `forge_scope`, `forge_impact`, `forge_changes`, and `forge_rename` use indexed structure instead of plain text search alone.
- Generated artifacts for repository maps, contracts, and wiki-style summaries.

### Low-Context Research

- `forge_batch` runs one or more repo-local shell commands and stores the full output in ContextForge’s research index.
- `forge_lookup` queries that stored output later without replaying raw logs into the conversation.

### Durable Memory

- `forge_memory_wakeup` loads compact L0/L1 wake-up memory before a new session or handoff.
- `forge_memory_recall`, `forge_memory_navigate`, and `forge_memory_search` retrieve scoped or deep memory without confusing repo index state with long-term memory.
- Memory search now blends lexical hits, local semantic embeddings, entity/topology boosts, temporal hints, and provenance weighting instead of relying on plain keyword recall.
- `forge_memory_save`, diary tools, fact tools, and timelines store durable decisions, discoveries, and changing facts in a global SQLite memory store.

### Prompt-Aware Routing

- ContextForge now uses a shared prompt-signal router across startup, skills, hooks, and MCP guidance.
- That means the explicit slash commands and the natural-language path are aligned instead of drifting apart.
- Broad repo prompts, targeted file prompts, memory prompts, diff prompts, and shell-heavy research prompts now resolve to the same `forge_*` families more consistently.

### Multi-Repo Surfaces

- Global registry of indexed repositories.
- Repo groups for cross-repository search and status checks.
- MCP resources for repo overview, flows, schema, contracts, map previews, and group status.
- Local bridge server for HTTP access to compact repo summaries.

[⬆ back to top](#readme)

<a id="how-it-works"></a>
## How It Works

1. `forge_start` primes the repository and either reuses a fresh index or begins a batched warm-up.
2. ContextForge stores repository structure, files, symbols, edges, chunks, session events, and research sections in `.contextforge/contextforge.db`.
3. ContextForge stores durable long-term memory in `~/.contextforge/memory/contextforge-memory.db` so wake-up profiles, facts, diaries, and checkpoints survive repo/session boundaries.
4. Claude calls compact `forge_*` tools or MCP resources instead of repeatedly crawling files by hand.
5. File writes, edits, repo changes, and session checkpoints resync the index and autosave meaningful memory so later calls answer from updated repository state.

For broad prompts, the intended flow is:

```text
forge_start -> forge_scan / forge_understand / forge_walk -> targeted forge_search / forge_symbol / forge_impact -> repo-native operations
```

For shell-heavy work, the intended flow is:

```text
forge_batch -> local research index -> forge_lookup
```

For durable memory, the intended flow is:

```text
forge_memory_wakeup -> forge_memory_recall / forge_memory_search -> forge_memory_save / forge_memory_fact_add / forge_memory_diary_write
```

For natural-language routing, the intended flow is:

```text
user prompt -> shared intent classifier -> best-fit forge_* tool -> compact receipt or targeted result
```

[⬆ back to top](#readme)

<a id="installation"></a>
## Installation

### Claude Code Marketplace

```text
/plugin marketplace add Yabuku-xD/contextforge
/plugin install contextforge@contextforge --scope project
```

Other scopes:

```text
/plugin install contextforge@contextforge --scope user
/plugin install contextforge@contextforge --scope local
```

### From a Local Checkout

```bash
npm install
node ./dist/src/cli.js install-claude .
```

If you explicitly want mutation tools and `dontAsk` seeded too:

```bash
node ./dist/src/cli.js install-claude . --allow-mutations --dont-ask
```

### Optional Global CLI Install

```bash
npm install -g .
contextforge doctor .
contextforge-mcp --root .
```

[⬆ back to top](#readme)

<a id="usage"></a>
## Usage

### Example Prompts

```text
Use ContextForge only. Warm this repo and summarize the architecture.
```

```text
Use ContextForge only. Walk the whole repository and tell me the major packages, entrypoints, and important files.
```

```text
Use ContextForge only. Use forge_batch for shell-heavy research and forge_lookup for follow-up questions.
```

```text
Use ContextForge only. Show me the blast radius of changing createCheckout.
```

### Useful CLI Commands

```bash
npm run typecheck
npm test
node ./dist/src/cli.js doctor .
node ./dist/src/cli.js scoreboard .
node ./dist/src/cli.js search "checkout timeout" .
node ./dist/src/cli.js memory-status .
node ./dist/src/cli.js memory-navigate .
node ./dist/src/cli.js memory-search "SQLite decision" .
node ./dist/src/cli.js changes unstaged .
node ./dist/src/cli.js serve .
```

[⬆ back to top](#readme)

<a id="automatic-routing"></a>
## Automatic Routing

You can call the slash commands directly, but ContextForge is meant to work well from normal prompts too.

Examples:

| Natural prompt | Expected tool family |
| --- | --- |
| `understand this repo and explain the architecture` | `forge_start` -> `forge_understand` |
| `go through every file, folder, and subfolder in this project` | `forge_start` -> `forge_walk` |
| `what touched this branch?` | `forge_changes` |
| `what role does test.sh play?` | `forge_why` |
| `what breaks if I change src/mcp-server.ts?` | `forge_impact` |
| `show me src/contextforge.ts` | `forge_read` |
| `replace this exact block in src/contextforge.ts` | `forge_edit` |
| `create docs/notes.md with this content` | `forge_write` |
| `run git status here` | `forge_bash` |
| `run tests and summarize the failures` | `forge_batch` |
| `search the saved logs from earlier` | `forge_lookup` |
| `continue where we left off` | `forge_resume` |
| `what should you remember before we continue?` | `forge_memory_wakeup` |
| `what do you remember about auth retries?` | `forge_memory_search` |
| `show the memory map for this project` | `forge_memory_navigate` |
| `timeline of ContextForge versions` | `forge_memory_timeline` |
| `make me a repo map` | `forge_map` |

This routing is driven by the same shared signal extractor used by the router skill, startup classifier, RAPTOR strategy routing, and Claude hook guidance.

[⬆ back to top](#readme)

<a id="tool-families"></a>
## Tool Families

| Area | Tools |
| --- | --- |
| Warm-up and status | `forge_start`, `forge_stats`, `forge_doctor` |
| Broad repo understanding | `forge_scan`, `forge_understand`, `forge_walk` |
| Retrieval and targeting | `forge_search`, `forge_symbol`, `forge_scope`, `forge_impact`, `forge_why` |
| Git-aware workflows | `forge_changes`, `forge_rename` |
| Low-context research | `forge_batch`, `forge_lookup` |
| Durable memory | `forge_memory_status`, `forge_memory_wakeup`, `forge_memory_recall`, `forge_memory_navigate`, `forge_memory_search`, `forge_memory_save`, `forge_memory_profile_set`, `forge_memory_profile_get`, `forge_memory_diary_write`, `forge_memory_diary_read`, `forge_memory_fact_add`, `forge_memory_fact_invalidate`, `forge_memory_fact_query`, `forge_memory_timeline` |
| Repo-native operations | `forge_read`, `forge_write`, `forge_edit`, `forge_bash` |
| Multi-repo and generated artifacts | `forge_list_repos`, `forge_group_query`, `forge_group_status`, `forge_map`, `forge_contracts`, `forge_wiki` |

[⬆ back to top](#readme)

<a id="command-reference"></a>
## Command Reference

These are the user-facing chat commands exposed by the plugin. In normal use, natural-language prompts should auto-route to the same tools, but the slash commands are the most explicit way to trigger a specific ContextForge path.

| Command | Purpose |
| --- | --- |
| `/contextforge:contextforge [request]` | General router. Best default entry when you want ContextForge to choose the right repo-aware command for the task. |
| `/contextforge:forge-start [request]` | Warm ContextForge for the current repo and report index status or readiness. |
| `/contextforge:forge-memory-status` | Show the durable memory stack, layer counts, and whether wake-up memory is available. |
| `/contextforge:forge-memory-wakeup` | Load the compact wake-up capsule before continuing prior work or assuming remembered context. |
| `/contextforge:forge-memory-recall [query]` | Recall scoped memory for a topic, area, or room in the current repository. |
| `/contextforge:forge-memory-navigate` | Explore memory wings, halls, and rooms before doing deeper long-term-memory recall. |
| `/contextforge:forge-memory-search [query]` | Deep-search remembered entries, diary notes, and temporal facts. |
| `/contextforge:forge-memory-save [note]` | Save a durable decision, discovery, or preference into long-term memory. |
| `/contextforge:forge-memory-profile-set [profile]` | Save an identity or project profile into durable memory. |
| `/contextforge:forge-memory-profile-get [profile type]` | Show an identity or project profile from durable memory. |
| `/contextforge:forge-memory-diary-write [note]` | Write a diary or checkpoint note into durable memory. |
| `/contextforge:forge-memory-diary-read` | Read recent diary and checkpoint notes. |
| `/contextforge:forge-memory-fact-add [fact]` | Add a remembered temporal fact or relationship. |
| `/contextforge:forge-memory-fact-invalidate [fact]` | Retire a remembered fact when it is no longer true. |
| `/contextforge:forge-memory-fact-query [entity]` | Query remembered facts for a person, repo, tool, or concept. |
| `/contextforge:forge-memory-timeline [entity]` | Show how remembered facts changed over time. |
| `/contextforge:forge-scan [request]` | Fast first-pass repo overview: top-level structure, likely entrypoints, and where to start. |
| `/contextforge:forge-understand [request]` | Broad repo understanding for architecture, major areas, important packages, and key files. |
| `/contextforge:forge-walk [request]` | Exhaustive repo walk for whole-project prompts like every file, folder, and subfolder. |
| `/contextforge:forge-search [query]` | Find where a behavior, file, or code path is implemented. |
| `/contextforge:forge-symbol [query]` | Jump to an exact or fuzzy symbol such as a function, class, or identifier. |
| `/contextforge:forge-scope [query]` | Explain high-level structure, module relationships, and architectural scope. |
| `/contextforge:forge-impact [query]` | Show blast radius: what breaks or what else is affected if something changes. |
| `/contextforge:forge-why [query]` | Explain why a file, symbol, or behavior matters in the repo or current task. |
| `/contextforge:forge-changes [request]` | Summarize git changes and map them to files, symbols, and likely impact areas. |
| `/contextforge:forge-rename [request]` | Preview or apply a coordinated repository rename. |
| `/contextforge:forge-batch [request]` | Run shell-heavy research, tests, logs, or diffs without dumping raw output into chat. |
| `/contextforge:forge-lookup [query]` | Search stored output from earlier `forge_batch` runs. |
| `/contextforge:forge-read [path]` | Read a compact file excerpt or list a directory inside the repo. |
| `/contextforge:forge-write [instruction]` | Create or overwrite a file inside the repository. |
| `/contextforge:forge-edit [instruction]` | Apply an exact in-file text replacement with compact confirmation. |
| `/contextforge:forge-bash [command]` | Run a short repo-local shell command with compact output. |
| `/contextforge:forge-map [request]` | Generate a repository architecture map artifact. |
| `/contextforge:forge-contracts [request]` | Generate dependency and integration contract summaries between repo areas. |
| `/contextforge:forge-wiki [request]` | Generate living wiki-style documentation from the current index. |
| `/contextforge:forge-list-repos` | List repositories known to the global ContextForge registry. |
| `/contextforge:forge-group-query [request]` | Search across repositories in a named ContextForge group. |
| `/contextforge:forge-group-status [group]` | Show index and coverage status for repos in a ContextForge group. |
| `/contextforge:forge-session [query]` | Inspect current session memory, touched files, and recent session context. |
| `/contextforge:forge-resume` | Resume the current repository session with a compact summary. |
| `/contextforge:forge-stats` | Show compression, retrieval, pager, and repository runtime stats. |
| `/contextforge:forge-doctor` | Diagnose ContextForge installation, plugin health, and repo state. |
| `/contextforge:forge-tools [tool name]` | List available ContextForge tools or inspect one tool schema. |

[⬆ back to top](#readme)

<a id="documentation"></a>
## Documentation

- [INSTALL.md](./INSTALL.md) for technical installation, MCP configuration, runtime behavior, and command details
- [LICENSE](./LICENSE) for the project license
- [Releases](https://github.com/Yabuku-xD/contextforge/releases) for version history and shipped changes

[⬆ back to top](#readme)

<a id="license"></a>
## License

Released under the [MIT License](./LICENSE).

[⬆ back to top](#readme)
