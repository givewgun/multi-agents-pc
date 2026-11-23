---
trigger: model_decision
description: When to ask Claude (tandem ask claude) for review, hard debugging, or architecture help
---

# Asking Claude

You (Gemini) do the bulk work. Ask Claude only when it pays off:

- Final review of a non-trivial diff: `tandem review --agent claude`
- A bug you failed to fix after two attempts.
- Architecture or design decisions with long-term cost.

```
tandem ask claude "<self-contained task>" --model sonnet   # opus only for genuinely hard problems
```

Claude cannot see your conversation. Include goal, files, constraints and return format.
