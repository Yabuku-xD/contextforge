# ContextForge

<div align="center">

[![Docs](https://img.shields.io/badge/DOCS-README-4B5563?style=for-the-badge)](./README.md)
[![Claude Code](https://img.shields.io/badge/CLAUDE%20CODE-MARKETPLACE-2563EB?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)
[![Context Layer](https://img.shields.io/badge/CATEGORY-CONTEXT%20LAYER-FACC15?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)
[![Release](https://img.shields.io/badge/RELEASE-v0.1.6-C2410C?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)
[![License](https://img.shields.io/badge/LICENSE-MIT-166534?style=for-the-badge)](./LICENSE)

</div>

The context layer for Claude Code.

ContextForge helps teams keep coding sessions coherent, searchable, and durable as work gets longer, noisier, and more collaborative. It is designed for people who want Claude Code to stay oriented across large repositories, changing tasks, and repeated handoffs without turning every session into a context-management problem.

## Why It Exists

Most coding workflows break down in the same places:

- too much raw tool output floods the session
- important project context gets scattered across files, prompts, and prior runs
- architectural questions and impact analysis take too much manual digging
- long-running work loses continuity at the exact moment speed matters most

ContextForge is built to reduce that drag. It gives Claude Code a cleaner working memory surface, stronger repository awareness, and a more dependable sense of what matters right now.

## What You Get

- Better continuity across long sessions and repeated iterations
- Faster path from question to relevant code context
- Cleaner retrieval for architecture, scope, and blast-radius questions
- More reliable project memory without adding setup friction to every repo
- Open-source distribution with a marketplace-friendly Claude Code install flow

## Who It Is For

- Individual developers who want Claude Code to stay sharp across longer tasks
- Teams that want a reusable context layer instead of prompt-by-prompt workarounds
- Repositories where architecture, change impact, and session continuity matter

## Claude Code Marketplace Install

This repository is marketplace-ready for Claude Code.

Install flow:

```text
/plugin marketplace add Yabuku-xD/contextforge
/plugin install contextforge@contextforge --scope project
```

Other scopes:

```text
/plugin install contextforge@contextforge --scope user
/plugin install contextforge@contextforge --scope local
```

## What Happens After Install

Once installed, ContextForge gives Claude Code a stronger context operating layer for project work. The goal is simple: less time recovering context, less time re-explaining repository state, and more time moving work forward.

No extra environment file is required for the default install path.

## Open Source

ContextForge is open source under the MIT license and published from this repository:

- Repository: https://github.com/Yabuku-xD/contextforge
- License: [MIT](./LICENSE)

## Documentation

If you want deeper setup details, local development guidance, storage notes, or MCP-specific instructions, start here:

- [INSTALL.md](./INSTALL.md)
