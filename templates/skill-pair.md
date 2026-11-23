---
name: pair
description: Work with Gemini as a team — plan-critique, split by strength, dual review, second opinion, or hand over the lead. Use when the user says "work with gemini", "pair", "get gemini's view", "split this", or when a task is big enough that two agents beat one.
---

# Pair with Gemini (you are the lead)

Pick the pattern, keep Claude's plan usage low (you're the scarcer plan), and keep one thread id for the whole task (`thread: "<short-slug>"` on every `ask_gemini` call).

1. **plan-critique** (non-trivial plans): draft the plan → `ask_gemini` model `neon` "critique as an equal partner: top risks with fixes, what's missing, ≤300 words" → merge, and tell the user what changed and why.
2. **split** (big builds): you take the judgment-heavy slices (design, core logic, tricky edits). Give Gemini the volume slices (reading, boilerplate, tests, UI) with `edit: true`, strict file ownership, after a commit. Review its diff before integrating.
3. **dual-review** (before commits that matter): `tandem review --agent both`, or review yourself and `ask_gemini` "review this diff". Agreement → fix. Disagreement → investigate both claims.
4. **second-opinion** (stuck after 2 attempts): send symptoms, code and what was tried; ask for 3 alternative hypotheses.
5. **handoff-lead** (work shifts to broad exploration, UI or browser testing): tell the user Gemini is better placed to lead this part, write a summary to `handoffs/inbox/`, and suggest they continue in Antigravity.

Rules: the user's named agent or model wins. `route_task` tells you when to just do it yourself (`self: true`). Verify Gemini's output. Tell the user what each agent did.
