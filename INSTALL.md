<a id="install"></a>
# ContextForge Installation Guide

> Installation, runtime behavior, chat commands, native file operations, and deployment notes for `contextforge@0.1.18`.

## What This Guide Covers

This document is the technical companion to the main README. Use it when you want to:

- install ContextForge in Claude Code
- run it locally from this repository
- connect it as a generic stdio MCP server
- understand the available chat commands and native `forge_*` operations
- decide where runtime data should live

## Requirements

- Node.js `22.5+`
- `npm`
- Claude Code for the marketplace plugin flow

ContextForge bootstraps its runtime automatically and stores cached runtime assets under `~/.contextforge/runtime/`.

## 1. Claude Code Marketplace Install

This is the primary install path and the one most users should start with.

```text
/plugin marketplace add Yabuku-xD/contextforge
/plugin install contextforge@contextforge --scope project
```

Other scopes:

```text
/plugin install contextforge@contextforge --scope user
/plugin install contextforge@contextforge --scope local
```

Scope guide:

- `project`: best for a repository-level install that travels with the project
- `user`: best if you want ContextForge available across repositories
- `local`: best for a single local checkout or experiment

This marketplace installs directly from GitHub. No separate npm publish step is required for the plugin path.

## 2. What Gets Installed

The plugin includes:

- a Claude Code marketplace package in [.claude-plugin/plugin.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/plugin.json)
- marketplace metadata in [.claude-plugin/marketplace.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/marketplace.json)
- a stdio MCP definition in [.mcp.json](/Users/yabuku/Downloads/context-forge/.mcp.json)
- SessionStart routing guidance in [hooks/sessionstart.mjs](/Users/yabuku/Downloads/context-forge/hooks/sessionstart.mjs)

After install, Claude can call ContextForge as:

- an MCP server
- a set of chat commands
- a native repository execution layer for compact reads, writes, edits, and bash commands

## 3. Claude Code Chat Commands

ContextForge exposes these user-invocable commands:

```text
/contextforge:contextforge [request]
/contextforge:forge-understand [request]
/contextforge:forge-walk [request]
/contextforge:forge-read [path]
/contextforge:forge-write [instruction]
/contextforge:forge-edit [change request]
/contextforge:forge-bash [command]
/contextforge:forge-search [query]
/contextforge:forge-impact [target]
/contextforge:forge-resume
/contextforge:forge-stats
/contextforge:forge-doctor
```

Recommended command map:

- `/contextforge:forge-understand` for fast repo orientation
- `/contextforge:forge-walk` for deeper package-by-package or folder-by-folder walkthroughs
- `/contextforge:forge-read` for compact file excerpts or directory listings
- `/contextforge:forge-write` for file creation or overwrite
- `/contextforge:forge-edit` for exact replacements with small previews
- `/contextforge:forge-bash` for compact command execution inside the current repository
- `/contextforge:forge-search` and `/contextforge:forge-impact` for targeting and blast radius

## 4. ContextForge-Native File Operations

ContextForge now includes its own compact repo operations:

- `forge_read`
  Reads file excerpts with line numbers or lists directories without dumping full repository state.
- `forge_write`
  Creates or overwrites files inside the current repository.
- `forge_edit`
  Applies exact text replacements and returns a compact preview of the changed area.
- `forge_bash`
  Runs shell commands in the repository with summary-first output and compact stdout/stderr previews.

If you want Claude to prefer these over heavier built-in tool paths, tell it in your repository instructions or `AGENTS.md`.

## 5. Local Development Install

If you are working from this repository directly:

```bash
npm install
npm test
```

Useful local commands:

```bash
node ./src/cli.js doctor .
node ./src/cli.js release .
node ./src/cli.js scoreboard .
node ./src/cli.js understand "understand this repository" .
node ./src/cli.js walk "go through every major area in this repository" .
```

## 6. Optional Global CLI Install

If you want shell-level access to the binaries:

```bash
npm install -g .
```

Then:

```bash
contextforge doctor .
contextforge-mcp --root .
```

## 7. Generic MCP Client Install

ContextForge can also run as a generic stdio MCP server for other MCP-capable clients.

Direct command:

```bash
contextforge-mcp --root .
```

Alternative:

```bash
contextforge mcp-stdio --root .
```

Generic MCP config:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "contextforge-mcp",
      "args": ["--root", "."],
      "env": {
        "CONTEXTFORGE_USE_ACTIVE_SESSION": "1"
      }
    }
  }
}
```

If you are running from a checkout instead of a global install:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "node",
      "args": ["/absolute/path/to/contextforge/src/mcp-server.js", "--root", "."],
      "env": {
        "CONTEXTFORGE_USE_ACTIVE_SESSION": "1"
      }
    }
  }
}
```

## 8. Claude Code Project Configuration

Official Claude Code MCP docs:

- <https://code.claude.com/docs/en/mcp>

Project example:

- [project.mcp.json.example](/Users/yabuku/Downloads/context-forge/integrations/claude-code/project.mcp.json.example)

Manual Claude Code install from a target repository:

```bash
claude mcp add --transport stdio --scope project contextforge -- contextforge-mcp --root .
```

Manual Claude Code install from a local checkout:

```bash
claude mcp add --transport stdio --scope project contextforge -- node /absolute/path/to/contextforge/src/mcp-server.js --root .
```

## 9. Verify the Install

CLI verification:

```bash
contextforge doctor .
contextforge release .
contextforge scoreboard .
```

Direct MCP smoke test:

```bash
contextforge-mcp --root .
```

If the stdio server starts and stays alive, the MCP transport is available.

## 10. Runtime Files and Environment

ContextForge writes local runtime state to:

```text
.contextforge/
```

That directory holds the local database and active session state.

Useful environment variables:

- `CONTEXTFORGE_USE_ACTIVE_SESSION=1`
- `CONTEXTFORGE_REMEMBER_SESSION=1`
- `CONTEXTFORGE_SESSION_ID=<id>`
- `CONTEXTFORGE_USE_LLMLINGUA=1`

No `.env` file is required for the default install path.

## 11. Shared Data and Cloud Storage

Plugin scope and runtime storage are separate.

Recommended model:

- install with `user`, `project`, or `local` scope depending on how you want the plugin distributed
- keep local runtime state in `.contextforge/`
- use a separate backend if you want multi-user shared memory or shared session data

Recommended remote architecture:

- metadata and session graph: Turso or Postgres
- larger retrieved artifacts or snapshots: S3, R2, or GCS
- namespace by repository, branch, and session lineage

Avoid:

- putting `contextforge.db` on shared object storage for concurrent writes
- treating plugin cache directories as the source of truth

Current status:

- built-in runtime storage is local
- cloud-shared storage is an architecture pattern you can add, not a baked-in service
