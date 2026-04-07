# Claude Code

ContextForge ships as a local stdio MCP server, so Claude Code can install it with project scope or user scope.

Fastest install from the target project:

```bash
contextforge install-claude .
```

From a local checkout:

```bash
node /absolute/path/to/contextforge/dist/src/cli.js install-claude .
```

If you are developing ContextForge itself from source, run `npm run build` after changes and `npm run typecheck` to verify the compiler-checked TypeScript sources before reinstalling the local plugin.

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
claude mcp add --transport stdio --scope project contextforge -- node /absolute/path/to/contextforge/dist/src/mcp-server.js --root .
```

Once installed, Claude Code can also invoke ContextForge through chat commands:

```text
/contextforge:forge-understand [request]
/contextforge:forge-memory-wakeup
/contextforge:forge-memory-search [query]
/contextforge:forge-memory-save [note]
/contextforge:forge-walk [request]
/contextforge:forge-read [path]
/contextforge:forge-write [instruction]
/contextforge:forge-bash [command]
/contextforge:forge-search [query]
/contextforge:forge-impact [target]
/contextforge:forge-resume
/contextforge:forge-stats
/contextforge:forge-doctor
/contextforge:forge-edit [change request]
```

Use the memory commands when you want durable recall across sessions:

- `/contextforge:forge-memory-wakeup` before continuing prior work or assuming remembered context
- `/contextforge:forge-memory-search` to verify remembered notes or past decisions
- `/contextforge:forge-memory-save` to store a durable decision, discovery, or preference
