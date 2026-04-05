---
name: forge-map
description: |
  Generate a repository architecture map artifact from ContextForge's index.
  Trigger: /contextforge:forge-map [optional query]
user-invocable: true
---

# Forge Map

Use ContextForge to generate a compact architecture map.

## Instructions

1. Use the text after the command as the map query. If no text is provided, use: `generate a repository architecture map`.
2. Call `forge_map`.
3. Return the generated artifact summary and path.
