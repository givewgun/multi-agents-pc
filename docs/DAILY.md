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

## In Antigravity (Gemini leads)

Same team, roles swapped. Say "work with claude", "ask claude", "/pair", or "get claude's review". Gemini uses the tandem plugin's `ask_claude` tool, which prompts you first because it uses Claude limits, and keeps those calls small. Best when the work is big, UI-heavy, or parallel.

## See what they said to each other

`tandem show last`, `tandem show thread:<id>`, or the dashboard's **Conversations** tab. Every exchange is read from the agent's own transcript, with a "resume" command to reopen it. Your direct work with each agent is counted by Stop hooks, so **Who did the work** shows both sides.

## Pick models yourself

`tandem prefer gemini neon-high`, `tandem pin review claude:opus`, `tandem models`. Or just say it in chat: "ask gemini with neon-high".

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
