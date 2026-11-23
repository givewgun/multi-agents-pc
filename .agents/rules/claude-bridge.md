---
trigger: model_decision
description: When to ask Claude (via scripts/ask-claude.ps1) for review, hard debugging, or architecture help
---

# Asking Claude

You (Gemini) do the bulk work. Ask Claude only when it pays off:

- Final review of a non-trivial diff before the user merges.
- A bug you have failed to fix after two attempts.
- Architecture / design decisions with long-term cost.

Call (read-only by default):

```
powershell -File scripts/ask-claude.ps1 -Prompt "<self-contained task>" [-Model opus] [-Edit]
```

Claude cannot see your conversation. Put goal, files, constraints, and return format in the prompt, or write a task file from `handoffs/TEMPLATE.md` and pass `-PromptFile`. Use `-Model sonnet` (default) unless the task is genuinely hard.
