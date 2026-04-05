<div align="center">

<a id="readme"></a>

<h1>ContextForge</h1>

<p><strong>Claude-first repository intelligence for low-context coding workflows.</strong></p>

<p>
  ContextForge gives Claude Code a stronger operating layer for large repositories:
  repository understanding, graph-aware retrieval, impact analysis, compact research,
  session continuity, and repo-native file operations that do not flood the chat window.
</p>

[![Release](https://img.shields.io/badge/release-v0.1.34-C2410C?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge/releases)
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
- [Tool Families](#tool-families)
- [Documentation](#documentation)
- [License](#license)

<a id="what-it-is"></a>
## What It Is

ContextForge is an open-source MCP server, CLI, and Claude Code marketplace plugin that helps Claude stay oriented in real repositories. Instead of treating each prompt like a fresh crawl, it builds and reuses a local index of repository structure, symbols, graph edges, session events, and research output.

That lets Claude answer broad repository questions with compact receipts, trace changes through indexed graph relationships, keep large shell output out of chat, and operate on files inside the repo without constantly falling back to noisy manual exploration.

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
node ./src/cli.js install-claude .
```

If you explicitly want mutation tools and `dontAsk` seeded too:

```bash
node ./src/cli.js install-claude . --allow-mutations --dont-ask
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
node ./src/cli.js doctor .
node ./src/cli.js scoreboard .
node ./src/cli.js search "checkout timeout" .
node ./src/cli.js changes unstaged .
node ./src/cli.js serve .
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
