# Install

This file covers the supported install paths for ContextForge:

- local CLI usage from this repo
- stdio MCP usage for any MCP-capable client
- Claude Code project-scoped installation

## Fastest path

If your goal is Claude Code, the shortest install is:

```bash
contextforge install-claude .
```

or from the repo checkout:

```bash
node ./src/cli.js install-claude .
```

That creates or updates `.mcp.json` in the target project and registers ContextForge automatically.

## Claude Code marketplace install

This repo includes the Claude Code marketplace files:

- [.claude-plugin/marketplace.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/marketplace.json)
- [.claude-plugin/plugin.json](/Users/yabuku/Downloads/context-forge/.claude-plugin/plugin.json)
- [.mcp.json](/Users/yabuku/Downloads/context-forge/.mcp.json)

Users can install it like this:

```text
/plugin marketplace add Yabuku-xD/contextforge
/plugin install contextforge@contextforge --scope project
```

Other install scopes:

```text
/plugin install contextforge@contextforge --scope user
/plugin install contextforge@contextforge --scope local
```

What the scopes mean:

- `user`: installed once for your account across projects
- `project`: shared at the project level
- `local`: only for your local checkout of the current project

This marketplace installs the plugin directly from GitHub. There is no npm publish requirement for the Claude Code plugin flow.

## Requirements

- Node.js 18+ recommended
- `npm`

## 1. Install from this repo

From the repo root:

```bash
npm install
npm test
```

You can then run the CLI directly:

```bash
node ./src/cli.js doctor .
node ./src/cli.js release .
node ./src/cli.js scoreboard .
```

## 2. Optional local binary install

If you want `contextforge` and `contextforge-mcp` on your shell `PATH`, install the repo globally from the local checkout:

```bash
npm install -g .
```

After that:

```bash
contextforge doctor .
contextforge-mcp --root .
```

## 3. Generic MCP client install

ContextForge ships as a local stdio MCP server. Most MCP-capable clients can use one of these commands:

```bash
contextforge-mcp --root .
```

or:

```bash
contextforge mcp-stdio --root .
```

A generic stdio MCP config usually looks like:

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

If you are not doing a global install, point the client at the repo checkout directly:

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

## 4. Claude Code install

Official Claude Code MCP docs:

- https://code.claude.com/docs/en/mcp

### Project-scoped install

#### One-command installer

Recommended:

```bash
contextforge install-claude .
```

From a local checkout:

```bash
node ./src/cli.js install-claude .
```

This writes `.mcp.json` for you using the current ContextForge checkout or installed package path.

#### Manual install

From the target repository:

```bash
claude mcp add --transport stdio --scope project contextforge -- contextforge-mcp --root .
```

If you are running directly from the repo checkout instead of a global install:

```bash
claude mcp add --transport stdio --scope project contextforge -- node /absolute/path/to/contextforge/src/mcp-server.js --root .
```

### Project `.mcp.json` example

An example is included in:

- [`integrations/claude-code/project.mcp.json.example`](./integrations/claude-code/project.mcp.json.example)

Equivalent shape:

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

## 5. Verify the install

CLI:

```bash
contextforge doctor .
contextforge release .
contextforge scoreboard .
```

Direct MCP smoke test:

```bash
contextforge-mcp --root .
```

If the server starts without exiting, the stdio transport is available.

## 6. Useful environment variables

- `CONTEXTFORGE_USE_ACTIVE_SESSION=1`
  Reuse the remembered active session when available.
- `CONTEXTFORGE_REMEMBER_SESSION=1`
  Persist the current session as the active one.
- `CONTEXTFORGE_SESSION_ID=<id>`
  Force a specific session id.
- `CONTEXTFORGE_USE_LLMLINGUA=1`
  Enable the LLMLingua-2 compression backend.

## 7. Runtime files

ContextForge creates local runtime state in:

```text
.contextforge/
```

That directory contains the local database and active-session state.

No `.env` file is required for the default install path.

## 8. Shared cloud data

Do not use the plugin install location itself as shared data storage. Plugin scope and runtime data are separate concerns.

Recommended model:

- install the plugin with `--scope user`, `--scope project`, or `--scope local`
- keep ephemeral local state in `.contextforge/`
- use a separate remote backend for team-shared data

Best-practice cloud layout:

- metadata and session graph: Turso or Postgres
- larger retrieved artifacts or snapshots: S3, R2, or GCS
- namespace everything by repo id, branch, and session lineage

What not to do:

- do not put `contextforge.db` itself on shared object storage and let multiple people write to it concurrently
- do not treat the plugin cache as the source of truth

Current status:

- ContextForge today stores runtime data locally in `.contextforge/`
- team-shared cloud storage is a deployment architecture recommendation, not a built-in backend yet
