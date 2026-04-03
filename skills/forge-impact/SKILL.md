---
name: forge-impact
description: |
  Run ContextForge impact analysis to estimate blast radius for a symbol,
  file, or behavior.
  Trigger: /contextforge:forge-impact [target]
user-invocable: true
---

# Forge Impact

Use ContextForge to estimate what is likely affected by a change.

## Instructions

1. Use the text after the command as the target query.
2. If no target is provided, ask one concise follow-up question.
3. Call `forge_start` with the target query when useful.
4. Call `forge_impact` with the target query.
5. Present:
   - likely affected symbols or files
   - any especially risky downstream areas
   - a short practical takeaway for the user
