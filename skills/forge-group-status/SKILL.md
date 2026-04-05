---
name: forge-group-status
description: |
  Show index and coverage status for all repositories in a ContextForge group.
  Trigger: /contextforge:forge-group-status [group name]
user-invocable: true
---

# Forge Group Status

Use ContextForge to inspect the status of a multi-repo group.

## Instructions

1. Use the text after the command as the group name.
2. If no group name is provided, ask one concise follow-up question.
3. Call `forge_group_status`.
4. Present the group status compactly with readiness or coverage highlights first.
