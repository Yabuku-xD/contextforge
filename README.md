<div align="center">

<a id="readme"></a>

<h1>ContextForge</h1>

<p><strong>Claude-first repository intelligence for low-context coding workflows.</strong></p>

<p>
  ContextForge gives Claude Code a stronger operating layer for large repositories:
  repository understanding, graph-aware retrieval, impact analysis, compact research,
  session continuity, and repo-native file operations that do not flood the chat window.
</p>

[![Release](https://img.shields.io/badge/release-v0.1.48-C2410C?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge/releases)
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
- [Command Reference](#command-reference)
- [Tool Families](#tool-families)
- [Documentation](#documentation)
- [License](#license)

<a id="what-it-is"></a>
## What It Is

ContextForge is an open-source MCP server, CLI, and Claude Code marketplace plugin that helps Claude stay oriented in real repositories. Instead of treating each prompt like a fresh crawl, it builds and reuses a local index of repository structure, symbols, graph edges, session events, and research output.

That lets Claude answer broad repository questions with compact receipts, trace changes through indexed graph relationships, keep large shell output out of chat, and operate on files inside the repo without constantly falling back to noisy manual exploration.

The source tree now lives in `src/**/*.ts`, the hooks/tests/plugin bootstrap are TypeScript too, and the repo now passes a real `npm run typecheck` instead of relying on a transpile-only migration. The runnable CLI, MCP server, hooks, and tests are emitted under `dist/` during `npm install` / `npm run build`.

[⬆ back to top](#readme)

<a id="why-it-helps"></a>
## Why It Helps

- Reduces chat-window waste by returning compact repo digests instead of replaying broad manual crawls.
- Gives Claude better repo memory through a persistent local index with full text-body coverage and line counts.
- Improves targeting for search, symbol lookup, architecture questions, blast-radius analysis, and git change mapping.
- Adds a low-context research lane with `forge_batch` and `forge_lookup` so logs, diffs, and command output stay indexed locally.
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
3. Claude calls compact `forge_*` tools or MCP resources instead of repeatedly crawling files by hand.
4. File writes, edits, and repo changes resync the index so later calls answer from updated repository state.

For broad prompts, the intended flow is:

```text
forge_start -> forge_scan / forge_understand / forge_walk -> targeted forge_search / forge_symbol / forge_impact -> repo-native operations
```

For shell-heavy work, the intended flow is:

```text
forge_batch -> local research index -> forge_lookup
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
node ./dist/src/cli.js changes unstaged .
node ./dist/src/cli.js serve .
```

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
