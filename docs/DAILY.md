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

## Habits that pay off the most

1. **Never let an agent review its own important work.** Ask the *other* agent to critique non-trivial plans and diffs (`tandem review --agent claude`, `tandem review --agent both`, or `/pair`). Different model families catch different blind spots.
2. **Use the 2-strike rule for stuck bugs.** After two failed fix attempts by the lead, ask the partner for 3 alternative hypotheses instead of letting one agent dig deeper into a bad assumption.
3. **Skip delegation on tiny, tightly-coupled edits.** Handoffs cost context and latency; if the lead already holds the mental model, let it finish the edit itself (`tandem route --lead <you>` marks these `self: true`).
4. **Give Claude fewer, bigger jobs.** Each headless Claude call carries ~70k tokens of overhead (bench). Batch questions and send diffs or concise summaries.
5. **Commit before `--edit`.** Makes the partner's changes one `git diff` away.
6. **Check `tandem usage` and `tandem stats` periodically.** Keep headroom for your own interactive sessions (Claude's default tandem cap is 80%), and notice if you're burning Claude on mechanical typing.
7. **Not sure the routing fits your work?** Add a task to `src/bench/tasks.js`, run `tandem bench`, and tune the rule (ADR 0005).
