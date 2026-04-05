---
name: forge-wiki
description: |
  Generate living documentation for the repository from ContextForge's index.
  Trigger: /contextforge:forge-wiki [optional query]
user-invocable: true
---

# Forge Wiki

Use ContextForge to generate compact living docs for the repo.

## Instructions

1. Use the text after the command as the wiki query. If no text is provided, use: `generate repository wiki`.
2. Call `forge_wiki`.
3. Return the generated artifact summary and path.
