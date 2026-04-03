# ContextForge

ContextForge is a local context engine for code agents. It combines conservative compression, hybrid code retrieval, architecture lookup, impact analysis, session memory, and paging behind a CLI and a stdio MCP server.

## What it ships

- `contextforge` CLI for indexing, search, scope, impact, session, benchmarks, release gates, and scoreboards
- `contextforge-mcp` stdio MCP server for MCP-capable clients
- Claude Code install examples in [`integrations/claude-code`](./integrations/claude-code)
- local benchmark and comparison harnesses

## Core capabilities

- conservative compression with exact bypass for code, diffs, JSON, stack traces, CSV, and line-numbered snippets
- exact, BM25, dense, RAPTOR, and graph-reranked retrieval
- query-aware architecture lookup with collapsed or traversal RAPTOR routing
- JS/TS impact analysis with import and call resolution
- repo graph plus session graph memory
- session paging, fault tracking, eviction, pinning, and prefetch

## Quick start

```bash
npm install
npm test
node ./src/cli.js install-claude .
node ./src/cli.js release ./tests/fixtures/sample-app
node ./src/cli.js scoreboard ./tests/fixtures/sample-app
```

## Claude Code marketplace install

This repo is now marketplace-ready for Claude Code.

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

This marketplace installs directly from the GitHub repository, so there is no npm publish step for plugin installation.

For local development before using the marketplace flow, keep using:

```bash
node ./src/cli.js install-claude .
```

## Fastest Claude Code install

From the repo root or an installed package:

```bash
contextforge install-claude .
```

If you are running directly from the checkout without a global install:

```bash
node ./src/cli.js install-claude .
```

That writes a project-scoped `.mcp.json` entry for ContextForge automatically.

## Common commands

```bash
node ./src/cli.js doctor .
node ./src/cli.js index .
node ./src/cli.js search "checkout timeout" .
node ./src/cli.js scope "architecture overview of checkout and retry flow" .
node ./src/cli.js impact "shouldRetry" .
node ./src/cli.js why "checkout timeout" .
node ./src/cli.js stats .
node ./src/cli.js release .
node ./src/cli.js scoreboard .
```

## MCP tools

The MCP server exposes:

- `ctx_startup`
- `ctx_search`
- `ctx_symbol`
- `ctx_scope`
- `ctx_impact`
- `ctx_why`
- `ctx_session`
- `ctx_resume`
- `ctx_stats`
- `ctx_doctor`

Run it locally with:

```bash
contextforge-mcp --root .
```

or:

```bash
contextforge mcp-stdio --root .
```

## Benchmarks and release status

- `release` reports the final product state
- `scoreboard` prints side-by-side open-track, local SWE-bench subset, and local closed-track stats
- `compare` runs the open-track comparison against `bare_workflow`, `context_mode`, `token_savior`, and `contextforge`
- `phase3` bundles the open track, SWE-bench subset, and closed-track results

## Install

See [INSTALL.md](./INSTALL.md) for:

- local CLI setup
- generic MCP client setup
- Claude Code setup
- one-command Claude Code install
- config snippets and verification steps

## Notes

- Set `CONTEXTFORGE_USE_LLMLINGUA=1` to enable the LLMLingua-2 backend.
- Runtime state is stored under `.contextforge/`.
- Active session continuity uses `.contextforge/active-session.json`.
- No `.env` file is required for the default local/plugin install.
- Claude Code marketplace metadata lives in [.claude-plugin/marketplace.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/marketplace.json) and [.claude-plugin/plugin.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/plugin.json).
