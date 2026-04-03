---
name: forge-write
description: |
  Create or overwrite a file inside the current repository using
  ContextForge's native write tool.
  Trigger: /contextforge:forge-write [instruction]
user-invocable: true
---

# Forge Write

Use ContextForge to create or overwrite files with compact confirmation output.

## Instructions

1. Treat the text after the command as the write request.
2. If the target path or content is missing, ask one concise follow-up question.
3. Call `forge_write` with the target path and content.
4. Report whether the file was created or updated, plus the line or byte count.
