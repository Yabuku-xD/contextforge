---
name: forge-why
description: |
  Explain why a file, symbol, or behavior matters in this repository.
  Trigger: /contextforge:forge-why [query]
user-invocable: true
---

# Forge Why

Use ContextForge to answer "why does this matter?" questions.

## Instructions

1. Use the text after the command as the target query.
2. If no query is provided, ask one concise follow-up question.
3. Call `forge_start` when useful.
4. Call `forge_why`.
5. Present:
   - why it exists or matters
   - how it connects to the repo or current task
   - what would matter if it changed
