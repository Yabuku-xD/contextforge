---
name: forge-contracts
description: |
  Generate repository dependency and integration contracts from ContextForge.
  Trigger: /contextforge:forge-contracts [optional query]
user-invocable: true
---

# Forge Contracts

Use ContextForge to surface module boundaries and dependencies.

## Instructions

1. Use the text after the command as the contracts query. If no text is provided, use: `generate repository contracts`.
2. Call `forge_contracts`.
3. Return the generated artifact summary and the most important dependency boundaries.
