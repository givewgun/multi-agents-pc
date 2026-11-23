---
name: pair
description: Work with Gemini as a team — plan-critique, split by strength, dual review, second opinion, or hand over the lead. Use only when the user asks: "/pair", "work with gemini", "get gemini's view", or "use tandem freely". Never on your own initiative.
---

# Pair with Gemini (you are the lead)

Pick the pattern, keep Claude's plan usage low (you're the scarcer plan), and keep one thread id for the whole task (`thread: "<short-slug>"` on every `ask_gemini` call).

**Asked?** Only when the user asked (see description); "use tandem freely" covers the rest of that task. A call that returns "solo mode is on" → stop and do it yourself.

**First, decompose.** You decide what to delegate: split the task into parts, classify each yourself (`research`, `bulk-read`, `boilerplate`, `feature`, `ui`, `architecture`, `hard-debug`, `review`…) and pass that as `category` to `route_task` / `ask_gemini`. tandem then applies pins, budgets and the no-self-review rule; it does not understand the task.

1. **plan-critique** (non-trivial plans): draft the plan → `ask_gemini` model `neon` "critique as an equal partner: top risks with fixes, what's missing, ≤300 words" → merge, and tell the user what changed and why.
2. **split** (big builds): you take the judgment-heavy slices (design, core logic, tricky edits). Give Gemini the volume slices (reading, boilerplate, tests, UI) with `edit: true`, strict file ownership, after a commit. Review its diff before integrating.
3. **dual-review** (before commits that matter): `tandem review --agent both`, or review yourself and `ask_gemini` "review this diff". Agreement → fix. Disagreement → investigate both claims.
4. **second-opinion** (stuck after 2 attempts): send symptoms, code and what was tried; ask for 3 alternative hypotheses.
5. **handoff-lead** (work shifts to broad exploration, UI or browser testing): tell the user Gemini is better placed to lead this part, write a summary to `handoffs/inbox/`, and suggest they continue in Antigravity.

Rules: the user's named agent or model wins. `route_task` tells you when to just do it yourself (`self: true`). Verify Gemini's output. Tell the user what each agent did.
