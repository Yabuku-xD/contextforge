<div align="center">

<a id="readme"></a>

<h1>ContextForge</h1>

<p><strong>The repository intelligence layer for Claude Code.</strong></p>

<p>
  ContextForge gives Claude stronger memory, cleaner project understanding, and a more durable sense of what matters across large codebases, long sessions, and repeated handoffs.
</p>

[![Release](https://img.shields.io/badge/release-v0.1.27-C2410C?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge/releases)
[![License](https://img.shields.io/badge/license-MIT-166534?style=for-the-badge)](./LICENSE)
[![Node](https://img.shields.io/badge/node-22.5%2B-2563EB?style=for-the-badge)](https://nodejs.org/)
[![Claude Code](https://img.shields.io/badge/claude%20code-marketplace-4B5563?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)
[![GitHub Stars](https://img.shields.io/github/stars/Yabuku-xD/contextforge?style=for-the-badge)](https://github.com/Yabuku-xD/contextforge)

</div>

## Description

ContextForge is built for developers and teams who want Claude Code to stay oriented as work gets larger, noisier, and more collaborative. Instead of treating every session like a fresh start, it gives Claude a better operating layer for repository structure, retrieval, impact analysis, continuity, and focused execution.

It is designed for real-world project work: monorepos, architecture questions, repeated edits, long-running sessions, and the kind of repository complexity where generic prompting starts to break down.

## Features

- Gives Claude a stronger first-pass understanding of repositories, packages, folders, and entrypoints
- Primes the whole repository at startup with a batched warm index, then keeps the index fresh with targeted syncs as files change
- Improves retrieval for architecture, search, scope, and blast-radius questions
- Preserves continuity across longer sessions so work does not keep resetting
- Adds ContextForge-native repo operations for compact reads, writes, edits, and bash execution
- Seeds Claude project installs with a safer pre-allowed ContextForge toolset for repo understanding, while keeping mutation and shell approvals opt-in
- Ships as an open-source Claude Code marketplace plugin with project, user, and local scopes

## Why Teams Use It

- Less time re-explaining repository state to Claude
- Less context waste from broad manual exploration
- Faster path from question to relevant files and symbols
- More confidence when tracing impact before a change
- Better continuity across iteration-heavy workflows

## Claude Code Marketplace Install

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

Once installed, ContextForge becomes part of Claude Code’s working layer for project understanding and execution. The practical result is straightforward: better repo awareness, cleaner retrieval, stronger continuity, and a lower chance that every meaningful task turns into a full repository crawl.

No extra environment file is required for the default install path.

## Open Source

ContextForge is open source under the [MIT License](./LICENSE) and published from this repository:

- Repository: `Yabuku-xD/contextforge`
- Homepage: <https://github.com/Yabuku-xD/contextforge>

## Documentation

For setup details, local development, MCP usage, chat commands, runtime storage, and deployment notes, see [INSTALL.md](./INSTALL.md).
