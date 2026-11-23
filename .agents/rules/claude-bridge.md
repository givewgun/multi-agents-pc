---
trigger: model_decision
description: How to ask Claude (tandem ask claude) for review, hard debugging, or architecture help, once the user asks
---

# Asking Claude

You (Gemini) do the bulk work. Ask Claude only when the user asks ("ask claude", `/pair`, "use tandem freely"); otherwise offer it. If tandem says "solo mode is on", do it yourself. Once asked, it pays off for:

- Final review of a non-trivial diff: `tandem review --agent claude`
- A bug you failed to fix after two attempts.
- Architecture or design decisions with long-term cost.

```
tandem ask claude "<self-contained task>" --model sonnet   # opus only for genuinely hard problems
```

Claude cannot see your conversation. Include goal, files, constraints and return format.
