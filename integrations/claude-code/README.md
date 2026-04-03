# Claude Code

ContextForge ships as a local stdio MCP server, so Claude Code can install it with project scope or user scope.

Fastest install from the target project:

```bash
contextforge install-claude .
```

From a local checkout:

```bash
node /absolute/path/to/contextforge/src/cli.js install-claude .
```

That writes a project-scoped `.mcp.json` entry automatically.

Manual project-scoped `.mcp.json` example:

Project-scoped `.mcp.json` example:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "npx",
      "args": ["-y", "contextforge", "mcp-stdio"],
      "env": {
        "CONTEXTFORGE_USE_ACTIVE_SESSION": "1"
      }
    }
  }
}
```

Equivalent command from the target repository:

```bash
claude mcp add --transport stdio --scope project contextforge -- npx -y contextforge mcp-stdio
```

If you are running from a local checkout instead of an installed package, point Claude Code at the repo directly:

```bash
claude mcp add --transport stdio --scope project contextforge -- node /absolute/path/to/contextforge/src/mcp-server.js --root .
```

Once installed, Claude Code can also invoke ContextForge through chat commands:

```text
/contextforge:forge-understand [request]
/contextforge:forge-walk [request]
/contextforge:forge-search [query]
/contextforge:forge-impact [target]
/contextforge:forge-resume
/contextforge:forge-stats
/contextforge:forge-doctor
/contextforge:forge-edit [change request]
```
