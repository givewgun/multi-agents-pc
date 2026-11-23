# Daily use

One-time per machine: `npm i -g <repo>` → `tandem init --global` → restart Claude Code / Antigravity. Per project (optional): `tandem init`.

## In Claude Code (default place to work)

Just talk. Claude has the `ask_gemini` tool and `/gemini` skill everywhere.

| Say | What happens |
|---|---|
| "use gemini for the grunt work" | Claude plans and delegates reading/boilerplate/tests to Gemini, then reviews |
| "ask gemini to map this repo" | Gemini Neon reads, Claude gets a short summary (saves Claude context) |
| "get a second opinion from gemini" | Gemini critiques Claude's plan or diff |
| "what's the latest X? ask gemini" | Google-grounded answer, no Claude web tokens |

## In Antigravity

Build there when the work is big, UI-heavy, or parallel. Gemini can call `ask_claude` (prompts you first; it uses Claude limits) for final review or a stuck bug.

## Terminal

```bash
tandem route "task"                    # who should do it (free)
tandem run "task" [--edit]             # route + do it, falls back if one side fails
tandem review --agent both             # before every commit that matters
tandem ask gemini "..." --model neon   # direct call
tandem log                             # what happened today
tandem dashboard --open                # savings, budget, flow
```

## Habits that save the most

1. **Claude gets few, big jobs.** Each Claude call costs ~70k tokens of overhead (bench). Batch questions.
2. **Review = Gemini first, Claude last.** `tandem review --agent gemini` on every diff, `--agent claude` only on ones that matter.
3. **Commit before `--edit`.** Makes the other agent's changes one `git diff` away.
4. **Weekly look at `tandem stats`.** Gemini share < 50%? You're paying Claude for typing.
5. **Check `tandem usage` before a big session.** It shows both plans' 5h/weekly windows and reset times. A plan at its limit gets routed around automatically. Claude's limit defaults to 80% so your own sessions keep headroom.
6. **Not sure the routing fits your work?** Add a task to `src/bench/tasks.js`, run `tandem bench`, change the rule (ADR 0005).
